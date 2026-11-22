import { describe, expect, it } from 'vitest'
import {
  formatSftpUri,
  parseSftpUri,
  sftpChildUri,
  sftpConnectionKey,
  sftpNameOf,
  sftpParentUri
} from './sftp-uri'

const ID = '3f2a9c1e-0000-4000-8000-000000000001'

describe('sftp-uri', () => {
  it('格式化与解析往返', () => {
    for (const loc of [
      { connectionId: ID, identity: null, path: '/' },
      { connectionId: ID, identity: 'app1', path: '/opt/app1/log' },
      { connectionId: ID, identity: null, path: '/var/a b/%41/#x?/日本語/.hidden/trail ' }
    ]) {
      const uri = formatSftpUri(loc)
      expect(parseSftpUri(uri)).toEqual(loc)
      expect(new URL(uri).href).toBe(uri)
    }
    expect(formatSftpUri({ connectionId: ID, identity: null, path: '/' })).toBe(`sftp://${ID}`)
  })

  it('子项与父目录逐字符一致', () => {
    const root = `sftp://${ID}`
    const a = sftpChildUri(root, 'a b+c')
    expect(a).toBe(`sftp://${ID}/a%20b%2Bc`)
    expect(sftpParentUri(a)).toBe(root)
    expect(sftpParentUri(root)).toBeNull()
    expect(sftpNameOf(a)).toBe('a b+c')
    expect(sftpChildUri(`sftp://app1@${ID}/opt`, 'x')).toBe(`sftp://app1@${ID}/opt/x`)
  })

  it('连接键不含身份', () => {
    expect(sftpConnectionKey(`sftp://app1@${ID}/opt`)).toBe(`sftp://${ID}`)
  })

  it('非法输入', () => {
    expect(parseSftpUri('file:///C:/x')).toBeNull()
    expect(parseSftpUri(`sftp://Bad User@${ID}/`)).toBeNull()
    expect(parseSftpUri(`sftp://u:pw@${ID}/`)).toBeNull()
    expect(parseSftpUri('sftp:///x')).toBeNull()
  })
})
