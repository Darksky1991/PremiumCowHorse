import { useEffect } from 'react'
import type { OfflineShare } from '@pch/shared'
import { call, subscribe } from '@renderer/lib/ipc'
import { useReachabilityStore, type ReachabilityChange } from '@renderer/stores/reachability-store'

export interface ReachabilitySyncDeps {
  subscribe: (listener: (e: ReachabilityChange) => void) => () => void
  /** 主进程记录的当前断开共享（vfs.offlineShares） */
  fetchOffline: () => Promise<OfflineShare[]>
  apply: (e: ReachabilityChange) => void
}

/**
 * 先订阅 vfs.reachability，再查询一次当前断开的共享初始化（窗口启动、重新加载之前已断开的共享
 * 不会因为错过事件而显示为在线）。查询结果返回之前已收到事件的共享以事件为准（快照可能更旧）。
 * 查询失败时只靠之后的事件。返回停止函数（取消订阅，忽略迟到的查询结果）。
 */
export function startReachabilitySync(deps: ReachabilitySyncDeps): () => void {
  const seen = new Set<string>()
  let active = true
  const off = deps.subscribe((e) => {
    seen.add(e.share)
    deps.apply(e)
  })
  void deps.fetchOffline().then(
    (list) => {
      if (!active) return
      for (const o of list) {
        if (!seen.has(o.share)) deps.apply({ share: o.share, state: 'offline', since: o.since })
      }
    },
    () => undefined
  )
  return () => {
    active = false
    off()
  }
}

/**
 * 把主进程的可达状态写入 reachability-store。外壳在窗口存在期间一直挂载，
 * 侧栏切到其他视图时也不会漏掉事件（store 只能由 feature 写入，lint 的分层规则）。
 */
export function useReachabilityEvents(): void {
  const apply = useReachabilityStore((s) => s.apply)
  useEffect(
    () =>
      startReachabilitySync({
        subscribe: (listener) => subscribe('vfs.reachability', listener),
        fetchOffline: () => call('vfs.offlineShares', {}),
        apply
      }),
    [apply]
  )
}
