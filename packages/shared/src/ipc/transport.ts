/**
 * IPC 传输层只有两个固定通道：
 * - 渲染端 → 主进程：invoke(IPC_INVOKE, { channel, input })，由主进程按契约分发并校验
 * - 主进程 → 渲染端：send(IPC_EVENT, { event, payload })
 * 通道白名单只存在于主进程（契约），preload 不需要维护任何列表。
 */
export const IPC_INVOKE = 'pch:invoke'
export const IPC_EVENT = 'pch:event'

export interface InvokeEnvelope {
  channel: string
  input: unknown
}

export interface EventEnvelope {
  event: string
  payload: unknown
}
