import type { HostKeyPrompt } from '@pch/shared'

export interface HostKeyPromptSyncDeps {
  subscribe: (listener: (p: HostKeyPrompt) => void) => () => void
  /** 主进程中尚未回答的询问（connection.pendingHostKeyPrompts） */
  fetchPending: () => Promise<HostKeyPrompt[]>
  add: (p: HostKeyPrompt) => void
}

/**
 * 先订阅 connection.hostKeyPrompt，再查询一次尚未回答的询问（窗口重新加载之前发出的询问不会丢失；
 * 与 use-reachability-events 的做法相同）。同一询问可能经两条路都到达，去重由 enqueuePrompt 负责。
 * 查询失败时只靠之后的事件。返回停止函数（取消订阅，忽略迟到的查询结果）
 */
export function startHostKeyPromptSync(deps: HostKeyPromptSyncDeps): () => void {
  let active = true
  const off = deps.subscribe((p) => deps.add(p))
  void deps.fetchPending().then(
    (list) => {
      if (active) list.forEach((p) => deps.add(p))
    },
    () => undefined
  )
  return () => {
    active = false
    off()
  }
}

/** 加入队列末尾（同一 promptId 只保留一个，已在队列中时原样返回）；多个询问依次显示 */
export function enqueuePrompt(
  queue: readonly HostKeyPrompt[],
  p: HostKeyPrompt
): readonly HostKeyPrompt[] {
  return queue.some((q) => q.promptId === p.promptId) ? queue : [...queue, p]
}
