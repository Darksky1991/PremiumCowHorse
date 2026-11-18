import { useEffect } from 'react'
import { subscribe } from '@renderer/lib/ipc'
import { useReachabilityStore } from '@renderer/stores/reachability-store'

/**
 * 把主进程的 vfs.reachability 写入 reachability-store。外壳在窗口存在期间一直挂载，
 * 侧栏切到其他视图时也不会漏掉事件（store 只能由 feature 写入，lint 的分层规则）。
 */
export function useReachabilityEvents(): void {
  const apply = useReachabilityStore((s) => s.apply)
  useEffect(() => subscribe('vfs.reachability', apply), [apply])
}
