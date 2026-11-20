import { app, session, shell } from 'electron'
import type { i18n } from 'i18next'
import { resolveLanguage } from '@pch/shared'
import { EventBus } from '../core/event-bus'
import type { MainEvents } from '../core/events'
import { openDatabase, type Database } from '../infra/db/client'
import { createMainI18n } from '../infra/i18n'
import { createLogger, type Logger } from '../infra/logger'
import { createPaths, type AppPaths } from '../infra/paths'
import { SettingsRepo } from '../modules/settings/settings.repo'
import { SettingsService } from '../modules/settings/settings.service'
import { WindowService } from '../windows/window.service'
import { WorkspaceService } from '../modules/workspace/workspace.service'
import { LocalProvider } from '../vfs/providers/local.provider'
import { location } from '../vfs/location'
import { ScannerClient } from '../vfs/scanner-client'
import { forkScanner } from '../vfs/scanner-process'
import { VfsService } from '../vfs/vfs.service'
import { DocumentService } from '../vfs/document/document-service'
import { ScopeTable } from '../modules/web/scope'
import { createWebProtocolHandler } from '../modules/web/web-protocol'
import { WebViewManager } from '../modules/web/web-view-manager'
import {
  configureWebSession,
  createWebContentsView,
  WEB_PARTITION
} from '../modules/web/web-session'

export interface Container {
  paths: AppPaths
  logger: Logger
  db: Database
  bus: EventBus<MainEvents>
  settings: SettingsService
  workspaces: WorkspaceService
  vfs: VfsService
  scanner: ScannerClient
  documents: DocumentService
  i18n: i18n
  windows: WindowService
  web: WebViewManager
}

/**
 * 组合根：手动装配所有 service（不引入 DI 框架）。
 * 所有依赖关系在这一个文件里一目了然，测试时可以替换任意依赖。
 */
export async function createContainer(rendererUrl: string): Promise<Container> {
  const paths = createPaths()
  const logger = createLogger(paths)
  const db = await openDatabase(paths.database, logger)
  const bus = new EventBus<MainEvents>()

  const settings = await SettingsService.create(new SettingsRepo(db), bus)
  // 一次性调用（stat、条目添加的校验、降级模式的直接枚举）的超时按位置取 vfs.timeoutSec.*（总时长）
  const vfs = new VfsService([new LocalProvider()], {
    timeoutMs: (uri) => {
      let where: 'local' | 'network' = 'network'
      try {
        where = location(uri)
      } catch {
        // 无法判断位置（例如不规范的 file URI）：按较长的网络超时
      }
      return settings.get(`vfs.timeoutSec.${where}`) * 1000
    }
  })
  const workspaces = new WorkspaceService(db, vfs, bus, app.getPath('temp'))
  // 扫描进程随主进程启动；配置（根、设置）由 bootstrap 在启动与工作区 / 设置变化时下发
  const scanner = new ScannerClient({
    fork: () => forkScanner(logger),
    cacheFile: paths.indexDb,
    onChanged: (uri) => bus.emit('vfs.changed', { uri }),
    onReachability: (e) => bus.emit('vfs.reachability', e),
    log: logger
  })
  scanner.start()
  const i18n = createMainI18n(resolveLanguage(settings.get('general.language'), app.getLocale()))
  const windows = new WindowService(paths, settings, rendererUrl, () => i18n.t('common.appName'))
  // 文本文档：读取经 VfsService（开-读-关、按位置超时）；事件只发给文档所属的窗口
  const documents = new DocumentService({
    source: vfs,
    emit: (owner, event, payload) => windows.sendTo(owner, event, payload),
    fullIndexLimitBytes: () => settings.get('preview.maxTextSizeMB') * 1024 * 1024,
    preferredLanguage: () => resolveLanguage(settings.get('general.language'), app.getLocale())
  })

  // 浏览器视图（doc 第 15 节）：专用会话 + pch-web 协议（范围内只读）；视图归属窗口，事件只发给所属窗口
  const webScopes = new ScopeTable()
  const webSession = session.fromPartition(WEB_PARTITION)
  const web = new WebViewManager({
    createView: (events) => createWebContentsView(webSession, events),
    send: (owner, event, payload) => windows.sendTo(owner, event, payload),
    scopes: webScopes,
    openExternal: (url) => {
      shell.openExternal(url).catch((e: unknown) => logger.warn(`[web] openExternal ${url}`, e))
    },
    logger
  })
  configureWebSession(webSession, {
    handler: createWebProtocolHandler({ scopes: webScopes, vfs }),
    onDownload: (id) => web.notifyContents(id, 'download'),
    logger
  })

  return {
    paths,
    logger,
    db,
    bus,
    settings,
    workspaces,
    vfs,
    scanner,
    documents,
    i18n,
    windows,
    web
  }
}
