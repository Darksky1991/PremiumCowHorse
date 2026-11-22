import { describe, expect, it } from 'vitest'
import { ConnectionSaveInput, ConnectionTrustHostKeyInput } from './schema'

const valid = {
  name: ' 本番 ',
  host: 'example.com',
  port: 22,
  username: 'pchuser',
  auth: 'password' as const,
  keyPath: null,
  identities: ['app1', 'app2'],
  sftpServerPath: null
}

const ok = (v: unknown): boolean => ConnectionSaveInput.safeParse(v).success

describe('ConnectionSaveInput', () => {
  it('合法输入通过（name 被 trim，secret 可省略）', () => {
    const r = ConnectionSaveInput.parse({ ...valid, secret: 'pw', sudoSecret: null })
    expect(r.name).toBe('本番')
    expect(ok({ ...valid, sftpServerPath: '/usr/lib/openssh/sftp-server' })).toBe(true)
    expect('secret' in ConnectionSaveInput.parse(valid)).toBe(false)
  })
  it('secret / sudoSecret 含换行失败', () => {
    expect(ok({ ...valid, secret: 'a\nb' })).toBe(false)
    expect(ok({ ...valid, secret: 'a\rb' })).toBe(false)
    expect(ok({ ...valid, sudoSecret: 'a\nb' })).toBe(false)
  })
  it('identities 重复失败', () => {
    expect(ok({ ...valid, identities: ['app1', 'app1'] })).toBe(false)
  })
  it('sftpServerPath 含非法字符失败', () => {
    expect(ok({ ...valid, sftpServerPath: '/usr/x; rm -rf /' })).toBe(false)
  })
  it('username 大写失败', () => {
    expect(ok({ ...valid, username: 'Root' })).toBe(false)
  })
})

describe('ConnectionTrustHostKeyInput（I4：信任用户看到的密钥）', () => {
  const okTrust = (v: unknown): boolean => ConnectionTrustHostKeyInput.safeParse(v).success
  it('id 与 key（algorithm / fingerprint）必需', () => {
    const key = { algorithm: 'ssh-ed25519', fingerprint: 'SHA256:abc' }
    expect(okTrust({ id: 'c1', key })).toBe(true)
    expect(okTrust({ id: 'c1' })).toBe(false)
    expect(okTrust({ id: 'c1', key: { algorithm: 'ssh-ed25519' } })).toBe(false)
    expect(okTrust({ id: 'c1', key: { ...key, extra: 1 } })).toBe(false)
    expect(okTrust({ id: '', key })).toBe(false)
  })
})
