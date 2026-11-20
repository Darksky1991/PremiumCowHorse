import { app, session, shell } from 'electron'
import type { Logger } from '../infra/logger'
import { WEB_PARTITION } from '../modules/web/web-session'

const EXTERNAL_PROTOCOLS = new Set(['https:', 'mailto:'])

/**
 * 全局安全策略：禁止页面内导航到外部地址、禁止 window.open、拒绝所有权限请求。
 * 外部链接经协议白名单校验后交给系统浏览器打开。
 */
export function applySecurityPolicies(rendererUrl: string, logger: Logger): void {
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    logger.warn(`[security] denied permission: ${permission}`)
    callback(false)
  })

  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-attach-webview', (event) => event.preventDefault())
    // 浏览器视图（modules/web）在专用会话 persist:pch-web 中，由 web 模块施加自己的导航 / 新窗口处理
    // （同范围交给应用、外部交给系统浏览器、其余阻止）。只跳过这一个会话：其他任何 webContents 都施加下面的限制。
    // 按会话判断而非由 web 模块登记：web-contents-created 在 new WebContentsView() 的构造中同步发出，早于任何登记。
    // fromPartition 对同一分区返回同一个 Session 对象
    if (contents.session === session.fromPartition(WEB_PARTITION)) return
    contents.setWindowOpenHandler(({ url }) => {
      openExternalIfAllowed(url, logger)
      return { action: 'deny' }
    })
    contents.on('will-navigate', (event, url) => {
      if (!url.startsWith(rendererUrl)) {
        event.preventDefault()
        openExternalIfAllowed(url, logger)
      }
    })
  })
}

function openExternalIfAllowed(url: string, logger: Logger): void {
  try {
    if (EXTERNAL_PROTOCOLS.has(new URL(url).protocol)) void shell.openExternal(url)
    else logger.warn(`[security] blocked navigation: ${url}`)
  } catch {
    logger.warn(`[security] blocked invalid url: ${url}`)
  }
}
