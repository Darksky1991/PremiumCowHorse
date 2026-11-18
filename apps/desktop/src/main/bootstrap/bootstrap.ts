import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import { app, Menu, nativeTheme } from 'electron'
import { resolveLanguage } from '@pch/shared'
import { configureUserData } from '../infra/paths'
import { createHandlers } from '../ipc/handlers'
import { registerIpc } from '../ipc/router'
import {
  APP_BASE_URL,
  registerAppProtocol,
  registerPrivilegedSchemes
} from '../windows/app-protocol'
import { applySecurityPolicies } from '../windows/security'
import { createContainer, type Container } from './container'
import { registerShutdown } from './shutdown'

export const APP_USER_MODEL_ID = 'com.premiumcowhorse.app'

/**
 * 启动编排（架构文档 6.2 节）：
 * 单实例锁 → 注册特权协议（必须在 ready 之前）→ ready → 创建容器（日志、DB 迁移、设置）
 * → 主题 → app:// 协议 → IPC → 菜单 → 创建主窗口。
 */
export async function bootstrap(): Promise<void> {
  configureUserData()
  if (!app.requestSingleInstanceLock()) {
    // 已有实例在运行（同一 userData）：交给它处理（second-instance 事件会聚焦其窗口），本实例退出。
    // 此时日志尚未初始化，只输出到控制台，避免「启动后什么也没发生」时无从排查
    console.info('[app] another instance is already running; focusing it and exiting')
    app.quit()
    return
  }
  registerPrivilegedSchemes()

  // 开发环境由 electron-vite 注入渲染端 dev server 地址（HMR）
  const devUrl = is.dev ? process.env['ELECTRON_RENDERER_URL'] : undefined
  const rendererUrl = devUrl ? new URL('/', devUrl).toString() : APP_BASE_URL

  await app.whenReady()
  electronApp.setAppUserModelId(APP_USER_MODEL_ID)
  const c = await createContainer(rendererUrl)
  c.logger.info(`[app] starting v${app.getVersion()} renderer=${rendererUrl}`)

  nativeTheme.themeSource = c.settings.get('appearance.themeMode')
  if (!devUrl) registerAppProtocol(c.paths.renderer)
  applySecurityPolicies(rendererUrl, c.logger)
  const disposeIpc = registerIpc(createHandlers(c), c.logger, rendererUrl)
  // 无边框窗口使用自绘标题栏，不需要原生菜单（M5 再加托盘）
  Menu.setApplicationMenu(null)
  // 开发时 F12 开关 DevTools；生产环境屏蔽 Ctrl+R 等刷新快捷键
  app.on('browser-window-created', (_, window) => optimizer.watchWindowShortcuts(window))

  wireEvents(c)
  registerShutdown(c, disposeIpc)

  c.windows.openMainWindow()

  app.on('second-instance', () => c.windows.focusMain())
  app.on('activate', () => c.windows.openMainWindow())
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}

/** 主进程事件 → 原生外观同步 + 广播给渲染端 */
function wireEvents(c: Container): void {
  c.bus.on('settings.changed', (patch) => {
    const mode = patch['appearance.themeMode']
    if (mode) nativeTheme.themeSource = mode

    const language = patch['general.language']
    if (language) {
      void c.i18n.changeLanguage(resolveLanguage(language, app.getLocale()))
      c.windows.setTitle(c.i18n.t('common.appName'))
    }
    c.windows.broadcast('settings.changed', patch)
  })

  // 主题模式为「跟随系统」时，系统切换明暗也要同步窗口底色
  nativeTheme.on('updated', () => c.windows.syncChrome())
}
