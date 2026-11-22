/** 主窗口的关闭、会话结束与页面重置事件（由 bootstrap 接到退出守卫与桌面记录服务） */
export interface MainWindowHooks {
  /** close 事件；需要拦截时在其中 preventDefault */
  close?: (event: Electron.Event) => void
  /** Windows 的会话即将结束（关机、重启、注销） */
  querySessionEnd?: (event: Electron.WindowSessionEndEvent) => void
  /** Windows 的会话结束 */
  sessionEnd?: (event: Electron.WindowSessionEndEvent) => void
  /** 主窗口的页面换成了新文档（含重新加载）或渲染进程退出：页面中的状态（对话框）已不存在 */
  rendererReset?: () => void
}

/** bindMainWindowHooks 用到的窗口接口（测试用 EventEmitter 代替） */
export interface HookableWindow {
  on(event: 'close', listener: (event: Electron.Event) => void): unknown
  on(
    event: 'query-session-end' | 'session-end',
    listener: (event: Electron.WindowSessionEndEvent) => void
  ): unknown
  webContents: {
    on(event: 'did-navigate' | 'render-process-gone', listener: () => void): unknown
  }
}

/**
 * 把主窗口的事件转给 hooks（每次触发时取最新的 hooks）。
 * 页面重置用 did-navigate（只对主框架、提交了新文档才发出，重新加载也会发出），不用 did-start-navigation：
 * 被 will-navigate 阻止的导航（应用窗口里点外部链接）也会先发出它（knowledge/electron.md）
 */
export function bindMainWindowHooks(win: HookableWindow, hooks: () => MainWindowHooks): void {
  win.on('close', (e) => hooks().close?.(e))
  win.on('query-session-end', (e) => hooks().querySessionEnd?.(e))
  win.on('session-end', (e) => hooks().sessionEnd?.(e))
  win.webContents.on('did-navigate', () => hooks().rendererReset?.())
  win.webContents.on('render-process-gone', () => hooks().rendererReset?.())
}
