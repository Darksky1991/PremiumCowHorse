import { describe, expect, it } from 'vitest'
import type { ConnectionDto } from '@pch/shared'
import {
  buildSaveInput,
  hostPort,
  identityError,
  initialForm,
  type ConnectionForm
} from './connection-form'

const DTO: ConnectionDto = {
  id: 'c1',
  name: 'AP1',
  host: '10.0.0.5',
  port: 22,
  username: 'ope01',
  auth: 'password',
  keyPath: null,
  hasSecret: true,
  hasSudoSecret: false,
  identities: ['app1'],
  sftpServerPath: null,
  hostKey: null,
  presentedHostKey: null,
  authState: 'ok',
  state: 'idle',
  createdAt: 1,
  updatedAt: 1
}

const filled = (over: Partial<ConnectionForm> = {}): ConnectionForm => ({
  ...initialForm(),
  name: ' AP1 ',
  host: ' 10.0.0.5 ',
  port: '2222',
  username: 'ope01',
  secret: 'pw',
  ...over
})

describe('buildSaveInput', () => {
  it('新建：去掉首尾空白，端口转为数值，sudo 默认同登录密码（null）', () => {
    expect(buildSaveInput(filled())).toEqual({
      ok: true,
      input: {
        name: 'AP1',
        host: '10.0.0.5',
        port: 2222,
        username: 'ope01',
        auth: 'password',
        keyPath: null,
        secret: 'pw',
        sudoSecret: null,
        identities: [],
        sftpServerPath: null
      }
    })
  })

  it('必填与格式错误按字段返回', () => {
    const r = buildSaveInput(
      filled({ name: ' ', host: '', port: '70000', username: 'Ope', secret: '' })
    )
    expect(r).toEqual({
      ok: false,
      errors: {
        name: 'nameRequired',
        host: 'hostRequired',
        port: 'portInvalid',
        username: 'usernameInvalid',
        secret: 'passwordRequired'
      }
    })
    expect(buildSaveInput(filled({ username: '  ' }))).toEqual({
      ok: false,
      errors: { username: 'usernameRequired' }
    })
    expect(buildSaveInput(filled({ port: '22a' }))).toMatchObject({
      ok: false,
      errors: { port: 'portInvalid' }
    })
  })

  it('编辑：密码留空 = 不变（省略 secret），带上 id', () => {
    const r = buildSaveInput({ ...initialForm(DTO) }, DTO)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.input.id).toBe('c1')
    expect('secret' in r.input).toBe(false)
    expect(r.input.identities).toEqual(['app1'])
  })

  it('编辑：输入了新密码则提交', () => {
    const r = buildSaveInput({ ...initialForm(DTO), secret: 'new' }, DTO)
    expect(r.ok && r.input.secret).toBe('new')
  })

  it('编辑：认证方式改为私钥时，旧机密不沿用（口令留空 = 清除），必须选私钥文件', () => {
    expect(buildSaveInput({ ...initialForm(DTO), auth: 'key' }, DTO)).toEqual({
      ok: false,
      errors: { keyPath: 'keyPathRequired' }
    })
    const r = buildSaveInput({ ...initialForm(DTO), auth: 'key', keyPath: 'C:\\k\\id' }, DTO)
    expect(r.ok && r.input).toMatchObject({ auth: 'key', keyPath: 'C:\\k\\id', secret: '' })
  })

  it('K5：私钥认证、已保存口令：勾选「删除已保存的口令」且口令留空 → secret 为空串；不勾选 → 省略', () => {
    const dto: ConnectionDto = { ...DTO, auth: 'key', keyPath: 'C:/k/id', hasSecret: true }
    const kept = buildSaveInput({ ...initialForm(dto) }, dto)
    expect(kept.ok && 'secret' in kept.input).toBe(false)
    const cleared = buildSaveInput({ ...initialForm(dto), clearSecret: true }, dto)
    expect(cleared.ok && cleared.input.secret).toBe('')
    // 同时输入了新口令 → 以新口令为准
    const replaced = buildSaveInput({ ...initialForm(dto), clearSecret: true, secret: 'new' }, dto)
    expect(replaced.ok && replaced.input.secret).toBe('new')
  })

  it('K5：密码认证时 clearSecret 无效（密码不能清除）', () => {
    const r = buildSaveInput({ ...initialForm(DTO), clearSecret: true }, DTO)
    expect(r.ok && 'secret' in r.input).toBe(false)
  })

  it('编辑：没有保存过密码的密码认证必须输入密码', () => {
    const dto = { ...DTO, hasSecret: false }
    expect(buildSaveInput({ ...initialForm(dto) }, dto)).toMatchObject({
      ok: false,
      errors: { secret: 'passwordRequired' }
    })
  })

  it('新建私钥认证：口令可省略', () => {
    const r = buildSaveInput(filled({ auth: 'key', keyPath: 'C:\\k\\id', secret: '' }))
    expect(r.ok).toBe(true)
    if (r.ok) expect('secret' in r.input).toBe(false)
  })

  it('sudo「另外设置」：输入则提交；留空且已保存 = 不变；留空且未保存 = 错误', () => {
    const r1 = buildSaveInput(filled({ sudoMode: 'separate', sudoSecret: 'rootpw' }))
    expect(r1.ok && r1.input.sudoSecret).toBe('rootpw')
    expect(buildSaveInput(filled({ sudoMode: 'separate' }))).toMatchObject({
      ok: false,
      errors: { sudoSecret: 'sudoPasswordRequired' }
    })
    const dto = { ...DTO, hasSudoSecret: true }
    const form = initialForm(dto)
    expect(form.sudoMode).toBe('separate')
    const r2 = buildSaveInput(form, dto)
    expect(r2.ok && 'sudoSecret' in r2.input).toBe(false)
  })

  it('sftp-server 路径：自动 = null；指定时校验格式', () => {
    const r = buildSaveInput(
      filled({ sftpMode: 'custom', sftpServerPath: ' /usr/libexec/openssh/sftp-server ' })
    )
    expect(r.ok && r.input.sftpServerPath).toBe('/usr/libexec/openssh/sftp-server')
    expect(buildSaveInput(filled({ sftpMode: 'custom', sftpServerPath: 'sftp-server' }))).toEqual({
      ok: false,
      errors: { sftpServerPath: 'sftpServerPathInvalid' }
    })
    const auto = buildSaveInput(filled({ sftpMode: 'auto', sftpServerPath: 'junk' }))
    expect(auto.ok && auto.input.sftpServerPath).toBeNull()
  })
})

describe('identityError', () => {
  it('空白不算错误；格式、重复、上限', () => {
    expect(identityError('  ', [])).toBeNull()
    expect(identityError('app1', [])).toBeNull()
    expect(identityError('App1', [])).toBe('identityInvalid')
    expect(identityError('app 1', [])).toBe('identityInvalid')
    expect(identityError('app1', ['app1'])).toBe('identityDuplicate')
    const many = Array.from({ length: 20 }, (_, i) => `u${i}`)
    expect(identityError('root', many)).toBe('identityTooMany')
  })
})

describe('hostPort', () => {
  it('IPv6 地址加方括号', () => {
    expect(hostPort('10.0.0.5', 22)).toBe('10.0.0.5:22')
    expect(hostPort('::1', 2222)).toBe('[::1]:2222')
  })
})
