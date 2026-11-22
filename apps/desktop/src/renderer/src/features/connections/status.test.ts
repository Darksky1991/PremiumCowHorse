import { describe, expect, it } from 'vitest'
import type { ConnectionAuthState, ConnectionState, HostKeyInfo } from '@pch/shared'
import { connectionStatus } from './status'

const KEY: HostKeyInfo = { algorithm: 'ssh-ed25519', fingerprint: 'SHA256:new' }

const status = (
  state: ConnectionState,
  authState: ConnectionAuthState = 'ok',
  presentedHostKey: HostKeyInfo | null = null
): ReturnType<typeof connectionStatus> => connectionStatus({ state, authState, presentedHostKey })

describe('connectionStatus', () => {
  it('连接池状态对应各自的状态点', () => {
    expect(status('online')).toEqual({ kind: 'online', tone: 'ok', action: null })
    expect(status('idle')).toEqual({ kind: 'idle', tone: 'idle', action: null })
    expect(status('connecting')).toEqual({ kind: 'connecting', tone: 'busy', action: null })
    expect(status('offline')).toEqual({ kind: 'offline', tone: 'offline', action: null })
    expect(status('host-key-pending')).toMatchObject({ kind: 'hostKeyPending', action: null })
  })

  it('认证失败：持久化的锁定优先于连接池状态（重启后状态为 idle），提供「重新连接」', () => {
    expect(status('idle', 'auth-failed')).toEqual({
      kind: 'authFailed',
      tone: 'error',
      action: 'reconnect'
    })
    expect(status('auth-failed')).toMatchObject({ kind: 'authFailed', action: 'reconnect' })
    expect(status('host-key-changed', 'auth-failed', KEY)).toMatchObject({ kind: 'authFailed' })
  })

  it('主机密钥已变化：有出示的新密钥时提供「信任新的密钥」', () => {
    expect(status('host-key-changed', 'ok', KEY)).toEqual({
      kind: 'hostKeyChanged',
      tone: 'error',
      action: 'trustNewKey'
    })
    expect(status('host-key-changed')).toMatchObject({ kind: 'hostKeyChanged', action: null })
    expect(status('host-key-changed', 'sudo-auth-failed', KEY)).toMatchObject({
      kind: 'hostKeyChanged'
    })
  })

  it('sudo 认证失败：在线时也显示，提供「重新连接」', () => {
    expect(status('online', 'sudo-auth-failed')).toEqual({
      kind: 'sudoAuthFailed',
      tone: 'error',
      action: 'reconnect'
    })
  })
})
