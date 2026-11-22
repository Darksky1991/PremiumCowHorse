// 已建立的连接因错误断线（online → offline）时，让扫描进程立即重新读取该连接的远程条目根
// （设计 5.6，裁定 R21 / R22）：扫描进程对远程目录不做定期读取，不触发读取则资源树要等到下一次读取才显示断开。
// refresh 只让扫描进程读取：读取失败 → FS_UNAVAILABLE → 断开 → 退避探测，探测成功即恢复；
// 连接池的认证锁定 / 冷却照常生效，这里不做任何认证重试。
//
// 只在上一状态为 online 时触发一次。重连失败的序列是 offline → connecting → offline，
// 每次回到 offline 都是真实的状态变化（池只对「相同状态」去重）；若这些也触发 refresh，
// 而扫描进程对已断开的共享以 bypass + force 读取，就会形成 refresh → 拨号 → 失败 → offline → refresh 的紧循环，
// 并使退避探测失效。之后的重连完全交给扫描进程的退避探测。
// 取舍：由本函数记住每个连接的上一状态，而不是让池另发信号——池的状态机不必改动，且 online → offline
// 只有「已建立连接因错误关闭」一条路径（空闲 / 用户断开是 idle）。
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
  const previous = new Map<string, ConnectionState>()
  return (connectionId, state) => {
    const was = previous.get(connectionId)
    previous.set(connectionId, state)
    if (state !== 'offline' || was !== 'online') return
    deps
      .rootsOf(connectionId)
      .then((roots) => {
        if (roots.length > 0) deps.refresh(roots)
      })
      .catch((e: unknown) => deps.onError(connectionId, e))
  }
}
