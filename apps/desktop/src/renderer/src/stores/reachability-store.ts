import { create } from 'zustand'

/**
 * 与 @pch/shared 的 ReachabilityEvent 同形（stores/ 按分层规则不依赖其他层，这里按结构声明；
 * 写入方传入 shared 的事件对象时由类型检查保证兼容）
 */
export interface ReachabilityChange {
  share: string
  state: 'online' | 'offline'
  since: number
}

interface ReachabilityState {
  /** 断开的共享（`\\host\share`，小写）或卷（`C:`）→ 断开的时刻（Unix 毫秒） */
  offlineShares: Record<string, number>
  /** 收到 vfs.reachability：offline 记下，online 移除 */
  apply: (e: ReachabilityChange) => void
}

/**
 * 扫描进程报告的可达状态（设计 4.7）。主进程事件 vfs.reachability 由外壳（features/shell）
 * 订阅后写入，资源树据此在断开的根条目上显示图标（Task 8）。只记录本窗口启动后收到的变化。
 */
export const useReachabilityStore = create<ReachabilityState>((set, get) => ({
  offlineShares: {},
  apply: (e) => {
    const current = get().offlineShares
    if (e.state === 'offline') {
      if (current[e.share] === e.since) return
      set({ offlineShares: { ...current, [e.share]: e.since } })
      return
    }
    if (!Object.hasOwn(current, e.share)) return
    const next = { ...current }
    delete next[e.share]
    set({ offlineShares: next })
  }
}))
