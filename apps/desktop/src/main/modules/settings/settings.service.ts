import { isDeepStrictEqual } from 'node:util'
import {
  AppError,
  DEFAULT_SETTINGS,
  SettingsPatch,
  resolveSettings,
  type SettingKey,
  type Settings
} from '@pch/shared'
import type { EventBus } from '../../core/event-bus'
import type { MainEvents } from '../../core/events'
import type { SettingsRepo } from './settings.repo'

/**
 * 设置的业务规则：内存中保存完整设置（默认值 + 数据库差量），
 * 写入时只持久化与默认值不同的键，并只广播真正变化的键。
 */
export class SettingsService {
  private constructor(
    private readonly repo: SettingsRepo,
    private readonly bus: EventBus<MainEvents>,
    private current: Settings
  ) {}

  static async create(repo: SettingsRepo, bus: EventBus<MainEvents>): Promise<SettingsService> {
    return new SettingsService(repo, bus, resolveSettings(await repo.getAll()))
  }

  getAll(): Settings {
    return this.current
  }

  get<K extends SettingKey>(key: K): Settings[K] {
    return this.current[key]
  }

  async set(patch: unknown): Promise<void> {
    const parsed = SettingsPatch.safeParse(patch)
    if (!parsed.success)
      throw new AppError({ code: 'SETTINGS_INVALID', detail: parsed.error.message })

    const changed: Partial<Record<SettingKey, unknown>> = {}
    for (const [key, value] of Object.entries(parsed.data) as [SettingKey, unknown][]) {
      if (value === undefined || isDeepStrictEqual(value, this.current[key])) continue
      if (isDeepStrictEqual(value, DEFAULT_SETTINGS[key])) await this.repo.delete(key)
      else await this.repo.upsert(key, value)
      changed[key] = value
    }
    if (Object.keys(changed).length === 0) return

    this.current = { ...this.current, ...changed } as Settings
    this.bus.emit('settings.changed', changed as Partial<Settings>)
  }
}
