// 连接因错误进入 offline 时，立即让扫描进程重新读取该连接的远程条目根（设计 5.6，裁定 R21）：
// 扫描进程对远程目录不做定期读取，不触发读取则资源树要等到下一次读取才显示断开。
// refresh 只让扫描进程读取：读取失败 → FS_UNAVAILABLE → 断开 → 退避探测，探测成功即恢复；
// 连接池的认证锁定 / 冷却照常生效，这里不做任何认证重试。
// 状态为 idle（空闲断开 / 用户断开）等其他值时不触发；连接池对同一状态不重复推送。
import type { ConnectionState } from '@pch/shared'

export interface OfflineRefresherDeps {
  /** 该连接的远程 folder 条目根（已规范化） */
  rootsOf(connectionId: string): Promise<string[]>
  refresh(roots: string[]): void
  onError(connectionId: string, error: unknown): void
}

export function createOfflineRefresher(
  deps: OfflineRefresherDeps
): (connectionId: string, state: ConnectionState) => void {
  return (connectionId, state) => {
    if (state !== 'offline') return
    deps
      .rootsOf(connectionId)
      .then((roots) => {
        if (roots.length > 0) deps.refresh(roots)
      })
      .catch((e: unknown) => deps.onError(connectionId, e))
  }
}
