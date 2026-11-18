import { BrowserWindow, webContents } from 'electron'
import { AppError } from '@pch/shared'
import type { HandlersOf, IpcContext } from '../../ipc/router'

/** 自绘标题栏的窗口按钮：只作用于发起调用的那个窗口 */
export function windowHandlers(): HandlersOf<
  'window.minimize' | 'window.toggleMaximize' | 'window.close' | 'window.getState'
> {
  return {
    'window.minimize': async (_, ctx) => senderWindow(ctx).minimize(),
    'window.toggleMaximize': async (_, ctx) => {
      const win = senderWindow(ctx)
      if (win.isMaximized()) win.unmaximize()
      else win.maximize()
    },
    'window.close': async (_, ctx) => senderWindow(ctx).close(),
    'window.getState': async (_, ctx) => ({ maximized: senderWindow(ctx).isMaximized() })
  }
}

function senderWindow(ctx: IpcContext): BrowserWindow {
  const contents = webContents.fromId(ctx.senderId)
  const win = contents && BrowserWindow.fromWebContents(contents)
  if (!win || win.isDestroyed())
    throw new AppError({ code: 'UNKNOWN', detail: 'sender window not found' })
  return win
}
