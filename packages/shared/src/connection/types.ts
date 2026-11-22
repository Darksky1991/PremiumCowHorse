import type { AppErrorPayload } from '../errors/app-error'

export type ConnectionAuthKind = 'password' | 'key'
/** 持久化的认证状态：失败后不再自动重试（避免触发服务器锁定账号） */
export type ConnectionAuthState = 'ok' | 'auth-failed' | 'sudo-auth-failed'
export type ConnectionState =
  | 'idle'
  | 'connecting'
  | 'online'
  | 'offline'
  | 'auth-failed'
  | 'host-key-pending'
  | 'host-key-changed'

export interface HostKeyInfo {
  algorithm: string
  fingerprint: string
}

export interface ConnectionDto {
  id: string
  name: string
  host: string
  port: number
  username: string
  auth: ConnectionAuthKind
  keyPath: string | null
  hasSecret: boolean
  hasSudoSecret: boolean
  identities: string[]
  sftpServerPath: string | null
  hostKey: HostKeyInfo | null
  /** 主机密钥变化时服务器出示的新密钥（只在内存中；「信任新的密钥」用） */
  presentedHostKey: HostKeyInfo | null
  authState: ConnectionAuthState
  state: ConnectionState
  createdAt: number
  updatedAt: number
}

/** 首次连接时请求渲染端确认主机密钥 */
export interface HostKeyPrompt {
  promptId: string
  connectionId: string
  name: string
  host: string
  port: number
  key: HostKeyInfo
}

export type ConnectionTestStepKind = 'connect' | 'hostKey' | 'auth' | 'sftp' | 'identity'

export interface ConnectionTestStep {
  step: ConnectionTestStepKind
  identity?: string
  ok: boolean
  error?: AppErrorPayload
  info?: { home?: string; sftpServerPath?: string; mode?: 'nopty' | 'pty' }
}

export interface ConnectionTestResult {
  steps: ConnectionTestStep[]
}
