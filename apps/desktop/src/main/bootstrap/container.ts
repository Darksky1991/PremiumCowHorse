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

export interface Container {
  paths: AppPaths
  logger: Logger
  db: Database
  bus: EventBus<MainEvents>
  settings: SettingsService
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
  const i18n = createMainI18n(resolveLanguage(settings.get('general.language'), app.getLocale()))
  const windows = new WindowService(paths, settings, rendererUrl, () => i18n.t('common.appName'))

  return { paths, logger, db, bus, settings, i18n, windows }
}
