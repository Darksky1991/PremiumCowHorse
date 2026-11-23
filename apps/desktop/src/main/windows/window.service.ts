import { app, BrowserWindow, webContents } from 'electron'
import {
  IPC_EVENT,
  resolveLanguage,
  type EventEnvelope,
  type IpcEventName,
  type IpcEvents
} from '@pch/shared'
import type { AppPaths } from '../infra/paths'
import type { SettingsService } from '../modules/settings/settings.service'
import { bindMainWindowHooks, type MainWindowHooks } from './main-window-hooks'
import { createAppWindow, syncWindowChrome } from './window-factory'

export type { MainWindowHooks } from './main-window-hooks'

/**
 * 窗口管理。M0 只有主窗口；标签弹出产生的 detached 窗口在 M3 由 LayoutService 驱动。
 */
export class WindowService {
  private main: BrowserWindow | null = null
  private hooks: MainWindowHooks = {}

  constructor(
    private readonly paths: AppPaths,
    private readonly settings: SettingsService,
    private readonly rendererUrl: string,
    private readonly title: () => string
  ) {}

  /** 在 openMainWindow 之前设置；只作用于主窗口 */
  setMainWindowHooks(hooks: MainWindowHooks): void {
    this.hooks = hooks
  }

  openMainWindow(): BrowserWindow {
    if (this.main && !this.main.isDestroyed()) {
      this.focusMain()
      return this.main
    }
    const settings = this.settings.getAll()
    const win = createAppWindow({
      url: this.rendererUrl,
      preload: this.paths.preload,
      icon: this.paths.appIcon,
      title: this.title(),
      language: resolveLanguage(settings['general.language'], app.getLocale()),
      settings
    })
    bindMainWindowHooks(win, () => this.hooks)
    win.on('closed', () => {
      this.main = null
    })
    this.main = win
    return win
  }

  focusMain(): void {
    if (!this.main || this.main.isDestroyed()) return
    if (this.main.isMinimized()) this.main.restore()
    this.main.focus()
  }

  /** 主窗口的渲染端是否存活（webContents 未销毁且未崩溃） */
  mainRendererAlive(): boolean {
    if (!this.main || this.main.isDestroyed()) return false
    const contents = this.main.webContents
    return !contents.isDestroyed() && !contents.isCrashed()
  }

  /** 只发给主窗口；没有主窗口时不做任何事 */
  sendToMain<E extends IpcEventName>(event: E, payload: IpcEvents[E]): void {
    if (!this.main || this.main.isDestroyed()) return
    this.sendTo(this.main.webContents.id, event, payload)
  }

  /** 关闭主窗口（会再次经过 close 事件） */
  closeMain(): void {
    if (this.main && !this.main.isDestroyed()) this.main.close()
  }

  /** 向所有窗口广播主进程事件 */
  broadcast<E extends IpcEventName>(event: E, payload: IpcEvents[E]): void {
    const envelope: EventEnvelope = { event, payload }
    for (const win of this.all()) win.webContents.send(IPC_EVENT, envelope)
  }

  /** 只发给一个窗口（webContents id）；已销毁时不做任何事 */
  sendTo<E extends IpcEventName>(webContentsId: number, event: E, payload: IpcEvents[E]): void {
    const target = webContents.fromId(webContentsId)
    if (!target || target.isDestroyed()) return
    const envelope: EventEnvelope = { event, payload }
    target.send(IPC_EVENT, envelope)
  }

  syncChrome(): void {
    const themeName = this.settings.get('appearance.theme')
    for (const win of this.all()) syncWindowChrome(win, themeName)
  }

  setTitle(title: string): void {
    for (const win of this.all()) win.setTitle(title)
  }

  private all(): BrowserWindow[] {
    return BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed())
  }
}
