import { describe, expect, it } from 'vitest'
import { fileUriToWindowsPath } from './file-uri'

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
