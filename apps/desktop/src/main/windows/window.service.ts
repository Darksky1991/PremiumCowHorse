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
import { createAppWindow, syncWindowChrome } from './window-factory'

/**
 * 窗口管理。M0 只有主窗口；标签弹出产生的 detached 窗口在 M3 由 LayoutService 驱动。
 */
export class WindowService {
  private main: BrowserWindow | null = null

  constructor(
    private readonly paths: AppPaths,
    private readonly settings: SettingsService,
    private readonly rendererUrl: string,
    private readonly title: () => string
  ) {}

  openMainWindow(): BrowserWindow {
    if (this.main && !this.main.isDestroyed()) {
      this.focusMain()
      return this.main
    }
    const settings = this.settings.getAll()
    const win = createAppWindow({
      url: this.rendererUrl,
      preload: this.paths.preload,
      title: this.title(),
      language: resolveLanguage(settings['general.language'], app.getLocale()),
      settings
    })
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
    for (const win of this.all()) syncWindowChrome(win)
  }

  setTitle(title: string): void {
    for (const win of this.all()) win.setTitle(title)
  }

  private all(): BrowserWindow[] {
    return BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed())
  }
}
