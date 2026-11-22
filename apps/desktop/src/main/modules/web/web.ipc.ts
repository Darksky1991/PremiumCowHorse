import type { HandlersOf } from '../../ipc/router'
import type { RemoteScope } from '../../vfs/remote-access'
import type { OwnerWindow, WebViewManager } from './web-view-manager'

type WebChannel =
  | 'web.attach'
  | 'web.setBounds'
  | 'web.hide'
  | 'web.release'
  | 'web.reload'
  | 'web.freeze'
  | 'web.unfreeze'

/**
 * 浏览器视图的 IPC：视图归属调用方窗口（owner = senderId）。参数已由路由按契约校验。
 * ownerOf 把 senderId 解析为窗口（真实实现为 web-session.ts 的 ownerWindowOf）。
 * web.attach 的 uri 与 scopeRoot（视图可读取的范围）为 sftp: 时必须在远程条目之下（设计 5.7）
 */
export function webHandlers(
  manager: Pick<
    WebViewManager,
    'attach' | 'setBounds' | 'hide' | 'release' | 'reload' | 'freeze' | 'unfreeze'
  >,
  ownerOf: (senderId: number) => OwnerWindow,
  scope: Pick<RemoteScope, 'check'>
): HandlersOf<WebChannel> {
  return {
    'web.attach': async (input, ctx) => {
      await Promise.all([scope.check(input.uri), scope.check(input.scopeRoot)])
      return manager.attach(ownerOf(ctx.senderId), input)
    },
    'web.setBounds': async ({ tabId, bounds }, ctx) =>
      manager.setBounds(ctx.senderId, tabId, bounds),
    'web.hide': async ({ tabId }, ctx) => manager.hide(ctx.senderId, tabId),
    'web.release': async ({ tabId }, ctx) => manager.release(ctx.senderId, tabId),
    'web.reload': async ({ tabId }, ctx) => manager.reload(ctx.senderId, tabId),
    'web.freeze': async ({ tabId }, ctx) => manager.freeze(ctx.senderId, tabId),
    'web.unfreeze': async ({ tabId, refocus }, ctx) =>
      manager.unfreeze(ctx.senderId, tabId, refocus)
  }
}
