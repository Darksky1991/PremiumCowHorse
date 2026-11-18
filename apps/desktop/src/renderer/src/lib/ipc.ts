import {
  AppError,
  type BootstrapData,
  type IpcChannel,
  type IpcEventName,
  type IpcEvents,
  type IpcInput,
  type IpcOutput,
  type IpcResult,
  type PchBridge
} from '@pch/shared'

declare global {
  interface Window {
    pch?: PchBridge
  }
}

/** 运行在 Electron 之外（例如直接用浏览器打开 dev server）时为 null */
export function getBridge(): PchBridge | null {
  return typeof window === 'undefined' ? null : (window.pch ?? null)
}

export function getBootstrap(): BootstrapData | null {
  return getBridge()?.bootstrap ?? null
}

function requireBridge(): PchBridge {
  const bridge = getBridge()
  if (!bridge) throw new AppError({ code: 'UNKNOWN', detail: 'window.pch is not available' })
  return bridge
}

/** 类型化的 IPC 调用：失败时抛出 AppError，交给 TanStack Query / ErrorBoundary 处理 */
export async function call<C extends IpcChannel>(
  channel: C,
  input: IpcInput<C>
): Promise<IpcOutput<C>> {
  const res = (await requireBridge().invoke(channel, input)) as IpcResult<IpcOutput<C>>
  if (!res.ok) throw new AppError(res.error)
  return res.data
}

/** 订阅主进程广播事件，返回取消订阅函数 */
export function subscribe<E extends IpcEventName>(
  event: E,
  listener: (payload: IpcEvents[E]) => void
): () => void {
  return requireBridge().on(event, (payload) => listener(payload as IpcEvents[E]))
}
