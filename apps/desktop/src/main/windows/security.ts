import { app, session, shell } from 'electron'
import type { Logger } from '../infra/logger'

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
    contents.on('will-attach-webview', (event) => event.preventDefault())
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
