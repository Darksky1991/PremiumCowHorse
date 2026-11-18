import { app } from 'electron'
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

export interface Container {
  paths: AppPaths
  logger: Logger
  db: Database
  bus: EventBus<MainEvents>
  settings: SettingsService
  workspaces: WorkspaceService
  vfs: VfsService
  scanner: ScannerClient
  i18n: i18n
  windows: WindowService
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
  const workspaces = new WorkspaceService(db, vfs, bus)
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

  return { paths, logger, db, bus, settings, workspaces, vfs, scanner, i18n, windows }
}
