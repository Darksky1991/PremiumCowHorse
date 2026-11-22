import type { ConnectionDto, ConnectionTrustHostKeyInput } from '@pch/shared'
import { errorCode } from './error-text'

/**
 * 「信任新的密钥」的输入：确认框中显示的新密钥（I4：主进程只在它与服务器最新出示的密钥一致时保存）。
 * 没有出示的新密钥 → null（不能信任）
 */
export function trustKeyInput(
  c: Pick<ConnectionDto, 'id' | 'presentedHostKey'>
): ConnectionTrustHostKeyInput | null {
  const k = c.presentedHostKey
  return k ? { id: c.id, key: { algorithm: k.algorithm, fingerprint: k.fingerprint } } : null
}

/**
 * 信任失败的处理：stale = 服务器在确认框打开之后又出示了别的密钥（CONN_HOST_KEY_CHANGED），
 * 确认框留着并显示刷新后的新密钥；failed = 其他错误（提示并关闭）
 */
export function trustFailure(e: unknown): 'stale' | 'failed' {
  return errorCode(e) === 'CONN_HOST_KEY_CHANGED' ? 'stale' : 'failed'
}
