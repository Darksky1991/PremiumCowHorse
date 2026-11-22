import type { HostKeyPrompt } from '@pch/shared'

export interface HostKeyPromptSyncDeps {
  subscribe: (listener: (p: HostKeyPrompt) => void) => () => void
  /** 询问已在主进程结束（回答 / 超时；connection.hostKeyPromptClosed） */
  subscribeClosed: (listener: (promptId: string) => void) => () => void
  /** 主进程中尚未回答的询问（connection.pendingHostKeyPrompts） */
  fetchPending: () => Promise<HostKeyPrompt[]>
  add: (p: HostKeyPrompt) => void
  remove: (promptId: string) => void
}

/**
 * 先订阅 connection.hostKeyPrompt / hostKeyPromptClosed，再查询一次尚未回答的询问（窗口重新加载之前发出的
 * 询问不会丢失；与 use-reachability-events 的做法相同）。同一询问可能经两条路都到达，去重由 enqueuePrompt 负责；
 * 查询结果中已收到「结束」的询问（快照比事件旧）不再加入。主进程超时或经其他途径回答时，确认框随事件收起。
 * 查询失败时只靠之后的事件。返回停止函数（取消订阅，忽略迟到的查询结果）
 */
export function startHostKeyPromptSync(deps: HostKeyPromptSyncDeps): () => void {
  let active = true
  const closed = new Set<string>()
  const offPrompt = deps.subscribe((p) => {
    if (!closed.has(p.promptId)) deps.add(p)
  })
  const offClosed = deps.subscribeClosed((promptId) => {
    closed.add(promptId)
    deps.remove(promptId)
  })
  void deps.fetchPending().then(
    (list) => {
      if (!active) return
      for (const p of list) if (!closed.has(p.promptId)) deps.add(p)
    },
    () => undefined
  )
  return () => {
    active = false
    offPrompt()
    offClosed()
  }
}

/** 加入队列末尾（同一 promptId 只保留一个，已在队列中时原样返回）；多个询问依次显示 */
export function enqueuePrompt(
  queue: readonly HostKeyPrompt[],
  p: HostKeyPrompt
): readonly HostKeyPrompt[] {
  return queue.some((q) => q.promptId === p.promptId) ? queue : [...queue, p]
}

/** 从队列移除（不在队列中时原样返回） */
export function dequeuePrompt(
  queue: readonly HostKeyPrompt[],
  promptId: string
): readonly HostKeyPrompt[] {
  return queue.some((q) => q.promptId === promptId)
    ? queue.filter((q) => q.promptId !== promptId)
    : queue
}
