import type { IpcEvents } from '@pch/shared'
import { subscribe } from '@renderer/lib/ipc'

type Listener<E extends keyof IpcEvents> = (payload: IpcEvents[E]) => void

/** 浏览器视图（web.*）的事件：每个都返回取消订阅函数 */
export interface WebEvents {
  onState: (listener: Listener<'web.state'>) => () => void
  onNavigate: (listener: Listener<'web.navigate'>) => () => void
  onNotice: (listener: Listener<'web.notice'>) => () => void
  onShortcut: (listener: Listener<'web.shortcut'>) => () => void
}

/**
 * 浏览器视图的事件订阅：预览宿主（features/preview/web-host.ts）按标签 id 分发。
 * 主进程只把事件发给视图所属的窗口
 */
export const webEvents: WebEvents = {
  onState: (listener) => subscribe('web.state', listener),
  onNavigate: (listener) => subscribe('web.navigate', listener),
  onNotice: (listener) => subscribe('web.notice', listener),
  onShortcut: (listener) => subscribe('web.shortcut', listener)
}
