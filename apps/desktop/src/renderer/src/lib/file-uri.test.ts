import { describe, expect, it } from 'vitest'
import { fileUriToWindowsPath, isShareOffline, isUncUri, shareKeyOfUri } from './file-uri'

describe('fileUriToWindowsPath', () => {
  it('转换盘符路径并解码百分号编码', () => {
    expect(fileUriToWindowsPath('file:///C:/%E6%A1%88%E4%BB%B6')).toBe('C:\\案件')
    expect(fileUriToWindowsPath('file:///D:/a%20b/c.txt')).toBe('D:\\a b\\c.txt')
  })

  it('带主机名的 URI 转为 UNC 路径', () => {
    expect(fileUriToWindowsPath('file://server/share/x')).toBe('\\\\server\\share\\x')
    expect(fileUriToWindowsPath('file://server/share/%E6%A1%88')).toBe('\\\\server\\share\\案')
  })

  it('盘符根目录保留结尾的反斜杠', () => {
    expect(fileUriToWindowsPath('file:///C:/')).toBe('C:\\')
  })

  it('百分号编码的反斜杠（%5C）解码后保留为反斜杠', () => {
    expect(fileUriToWindowsPath('file:///C:/a%5Cb')).toBe('C:\\a\\b')
  })

  it('非 file 协议、无法解析或解码失败时返回 null', () => {
    expect(fileUriToWindowsPath('smb://server/share')).toBeNull()
    expect(fileUriToWindowsPath('not a uri')).toBeNull()
    expect(fileUriToWindowsPath('file:///C:/%E0%A4%A')).toBeNull()
  })
})

describe('shareKeyOfUri', () => {
  it('盘符 → 大写盘符加冒号；UNC → 小写的主机与共享名', () => {
    expect(shareKeyOfUri('file:///c:/work/a')).toBe('C:')
    expect(shareKeyOfUri('file:///C:/')).toBe('C:')
    expect(shareKeyOfUri('file://Server/Share/x/y')).toBe('\\\\server\\share')
    expect(shareKeyOfUri('file://server/%E5%85%B1%E6%9C%89')).toBe('\\\\server\\共有')
  })

  it('非 file 协议或无法解析返回 null', () => {
    expect(shareKeyOfUri('https://example.com/a')).toBeNull()
    expect(shareKeyOfUri('not a uri')).toBeNull()
  })
})

describe('isShareOffline', () => {
  const offline = { '\\\\server\\share': 1, 'Z:': 2 }

  it('UNC 根与其子路径匹配，其他共享不匹配', () => {
    expect(isShareOffline('file://server/share', offline)).toBe(true)
    expect(isShareOffline('file://server/share/案件/a', offline)).toBe(true)
    expect(isShareOffline('file://server/other', offline)).toBe(false)
    expect(isShareOffline('file://other/share', offline)).toBe(false)
  })

  it('盘符（含映射盘）按盘符匹配，不区分大小写', () => {
    expect(isShareOffline('file:///Z:/data', offline)).toBe(true)
    expect(isShareOffline('file:///z:/data', offline)).toBe(true)
    expect(isShareOffline('file:///C:/data', offline)).toBe(false)
  })

  it('没有断开的共享或键无法求出时为 false', () => {
    expect(isShareOffline('file:///C:/a', {})).toBe(false)
    expect(isShareOffline('https://x/y', offline)).toBe(false)
  })
})

describe('isUncUri', () => {
  it('带主机名为 UNC，盘符为本地', () => {
    expect(isUncUri('file://server/share/x')).toBe(true)
    expect(isUncUri('file:///C:/x')).toBe(false)
    expect(isUncUri('https://x/y')).toBe(false)
  })
})
