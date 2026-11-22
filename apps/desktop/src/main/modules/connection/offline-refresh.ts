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
//
// I2（R24）：认证成功后服务器立即断开（例如 ChrootDirectory 属主错误时 sshd 关闭整条连接）也是
// online → offline；refresh 是 userAction + bypass + force，会立即重拨 → 再次 online → 断开 → 循环，且没有退避。
// 因此只在连接稳定存续超过一个保活周期之后断开时才触发，且每个连接 OFFLINE_REFRESH_GAP_MS 之内最多一次；
// 其余交给扫描进程的退避探测。
import type { ConnectionState } from '@pch/shared'

/** 每个连接触发 refresh 的最小间隔 */
export const OFFLINE_REFRESH_GAP_MS = 60_000

export interface OfflineRefresherDeps {
  /** 该连接的远程 folder 条目根（已规范化） */
  rootsOf(connectionId: string): Promise<string[]>
  refresh(roots: string[]): void
  onError(connectionId: string, error: unknown): void
  now(): number
  /** 连接稳定存续的下限（毫秒；组合根取 remote.keepaliveSec * 1000） */
  stableMs(): number
}

export function createOfflineRefresher(
  deps: OfflineRefresherDeps
): (connectionId: string, state: ConnectionState) => void {
  const previous = new Map<string, ConnectionState>()
  /** 进入 online 的时刻 */
  const onlineSince = new Map<string, number>()
  /** 上一次触发的时刻 */
  const lastRefresh = new Map<string, number>()
  return (connectionId, state) => {
    const was = previous.get(connectionId)
    previous.set(connectionId, state)
    const now = deps.now()
    if (state === 'online') onlineSince.set(connectionId, now)
    if (state !== 'offline' || was !== 'online') return
    const since = onlineSince.get(connectionId) ?? now
    if (now - since < deps.stableMs()) return
    const last = lastRefresh.get(connectionId)
    // 时钟回拨（差为负）时不算在间隔中
    if (last !== undefined && now - last >= 0 && now - last < OFFLINE_REFRESH_GAP_MS) return
    lastRefresh.set(connectionId, now)
    deps
      .rootsOf(connectionId)
      .then((roots) => {
        if (roots.length > 0) deps.refresh(roots)
      })
      .catch((e: unknown) => deps.onError(connectionId, e))
  }
}
