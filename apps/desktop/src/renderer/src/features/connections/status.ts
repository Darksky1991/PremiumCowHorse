import type { ConnectionDto } from '@pch/shared'

export type ConnectionStatusKind =
  | 'online'
  | 'idle'
  | 'connecting'
  | 'offline'
  | 'authFailed'
  | 'authUnsupported'
  | 'sudoAuthFailed'
  | 'hostKeyPending'
  | 'hostKeyChanged'

/** 状态点的颜色类别 */
export type ConnectionStatusTone = 'ok' | 'idle' | 'busy' | 'offline' | 'error'

export interface ConnectionStatusView {
  kind: ConnectionStatusKind
  tone: ConnectionStatusTone
  /** 行内提供的解除操作：认证锁定 →「重新连接」，密钥变化 →「信任新的密钥」 */
  action: 'reconnect' | 'trustNewKey' | null
}

/**
 * 连接状态（连接池的 ConnectionState）与持久化的认证锁定（authState）→ 状态点与文案（设计 5.3、5.8）。
 * 需要用户处理的状态优先：认证失败（锁定跨重启保留，连接池状态可能已回到 idle）> 主机密钥已变化 >
 * 主机密钥待确认 > sudo 认证失败（登录用户的 SFTP 不受影响，但切换身份被锁住）> 连接池状态
 */
export function connectionStatus(
  c: Pick<ConnectionDto, 'state' | 'authState' | 'presentedHostKey'>
): ConnectionStatusView {
  if (c.authState === 'auth-failed' || c.state === 'auth-failed') {
    return { kind: 'authFailed', tone: 'error', action: 'reconnect' }
  }
  if (c.state === 'host-key-changed') {
    // 「信任新的密钥」需要服务器出示过的新密钥（只在主进程内存中）
    return {
      kind: 'hostKeyChanged',
      tone: 'error',
      action: c.presentedHostKey === null ? null : 'trustNewKey'
    }
  }
  if (c.state === 'auth-unsupported') {
    return { kind: 'authUnsupported', tone: 'error', action: 'reconnect' }
  }
  if (c.state === 'host-key-pending') return { kind: 'hostKeyPending', tone: 'busy', action: null }
  if (c.authState === 'sudo-auth-failed') {
    return { kind: 'sudoAuthFailed', tone: 'error', action: 'reconnect' }
  }
  switch (c.state) {
    case 'online':
      return { kind: 'online', tone: 'ok', action: null }
    case 'connecting':
      return { kind: 'connecting', tone: 'busy', action: null }
    case 'offline':
      return { kind: 'offline', tone: 'offline', action: null }
    default:
      return { kind: 'idle', tone: 'idle', action: null }
  }
}

/** 状态点的样式（应用自己的元素，不是 shadcn 组件） */
export const toneClassName: Record<ConnectionStatusTone, string> = {
  ok: 'bg-emerald-500',
  idle: 'border border-muted-foreground',
  busy: 'bg-amber-500',
  offline: 'bg-muted-foreground',
  error: 'bg-destructive'
}
