import { describe, expect, it } from 'vitest'
import { AppError } from '@pch/shared'
import { trustFailure, trustKeyInput } from './trust-key'

const KEY = { algorithm: 'ssh-ed25519', fingerprint: 'SHA256:seen' }

describe('trustKeyInput（I4：信任的是对话框中显示的密钥）', () => {
  it('没有出示的新密钥 → null（不能信任）', () => {
    expect(trustKeyInput({ id: 'c1', presentedHostKey: null })).toBeNull()
  })

  it('取显示中的 presentedHostKey 的算法与指纹', () => {
    expect(trustKeyInput({ id: 'c1', presentedHostKey: { ...KEY } })).toEqual({
      id: 'c1',
      key: KEY
    })
  })
})

describe('trustFailure', () => {
  it('CONN_HOST_KEY_CHANGED → stale（服务器又出示了别的密钥：留在对话框中显示新密钥）', () => {
    expect(trustFailure(new AppError({ code: 'CONN_HOST_KEY_CHANGED' }))).toBe('stale')
  })

  it('其他错误 → failed', () => {
    expect(trustFailure(new AppError({ code: 'CONN_NOT_FOUND' }))).toBe('failed')
    expect(trustFailure(new Error('boom'))).toBe('failed')
  })
})
