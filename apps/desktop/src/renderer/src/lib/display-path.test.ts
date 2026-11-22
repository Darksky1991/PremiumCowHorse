import { describe, expect, it } from 'vitest'
import { copyablePath, displayPath, isLocalUri } from './display-path'

describe('displayPath', () => {
  it('sftp：<连接名>:<路径>；切换身份时 <身份>@<连接名>:<路径>（路径已解码）', () => {
    expect(displayPath('sftp://ID/var/log', { ID: 'AP1' })).toBe('AP1:/var/log')
    expect(displayPath('sftp://app1@ID/opt/a%20b', { ID: 'AP1' })).toBe('app1@AP1:/opt/a b')
    expect(displayPath('sftp://ID', { ID: 'AP1' })).toBe('AP1:/')
  })

  it('连接不在 names 中时用 connectionId', () => {
    expect(displayPath('sftp://ID/var/log', {})).toBe('ID:/var/log')
  })

  it('file → Windows 路径；其余（无法解析的 sftp、网页）原样', () => {
    expect(displayPath('file:///C:/%E6%A1%88%E4%BB%B6/a.txt', {})).toBe('C:\\案件\\a.txt')
    expect(displayPath('https://example.com/a', {})).toBe('https://example.com/a')
    expect(displayPath('sftp://ID/%E0%A4%A', {})).toBe('sftp://ID/%E0%A4%A')
  })
})

describe('copyablePath', () => {
  it('sftp → 服务器上的绝对路径（不含身份与连接）', () => {
    expect(copyablePath('sftp://app1@ID/opt/a%20b')).toBe('/opt/a b')
    expect(copyablePath('sftp://ID/home/pchuser')).toBe('/home/pchuser')
    expect(copyablePath('sftp://ID')).toBe('/')
  })

  it('file → Windows 路径；其余 null', () => {
    expect(copyablePath('file:///D:/a%20b/c.txt')).toBe('D:\\a b\\c.txt')
    expect(copyablePath('https://example.com/a')).toBeNull()
    expect(copyablePath('sftp://ID/%E0%A4%A')).toBeNull()
  })
})

describe('isLocalUri', () => {
  it('只有 file: 是本机资源', () => {
    expect(isLocalUri('sftp://ID/x')).toBe(false)
    expect(isLocalUri('file:///C:/x')).toBe(true)
    expect(isLocalUri('https://example.com/')).toBe(false)
  })
})
