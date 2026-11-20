import { beforeEach, describe, expect, it } from 'vitest'
import { AppError, DEFAULT_SETTINGS, type Settings } from '@pch/shared'
import { EventBus } from '../../core/event-bus'
import type { MainEvents } from '../../core/events'
import { openDatabase, type Database } from '../../infra/db/client'
import type { Logger } from '../../infra/logger'
import { SettingsRepo } from './settings.repo'
import { SettingsService } from './settings.service'

const noop = (): void => undefined
const silent: Logger = { error: noop, warn: noop, info: noop, debug: noop }

describe('SettingsService (node:sqlite :memory: + Kysely migrations)', () => {
  let db: Database
  let repo: SettingsRepo
  let bus: EventBus<MainEvents>
  let events: Partial<Settings>[]

  beforeEach(async () => {
    db = await openDatabase(':memory:', silent)
    repo = new SettingsRepo(db)
    bus = new EventBus<MainEvents>()
    events = []
    bus.on('settings.changed', (p) => events.push(p))
  })

  it('starts from defaults on an empty database', async () => {
    const service = await SettingsService.create(repo, bus)
    expect(service.getAll()).toEqual(DEFAULT_SETTINGS)
  })

  it('persists only values that differ from the default', async () => {
    const service = await SettingsService.create(repo, bus)
    await service.set({ 'appearance.themeMode': 'dark', 'appearance.accent': 'neutral' })
    expect(await repo.getAll()).toEqual({ 'appearance.themeMode': 'dark' })

    // 改回默认值时删除该行
    await service.set({ 'appearance.themeMode': 'system' })
    expect(await repo.getAll()).toEqual({})
  })

  it('survives a restart (new service instance reads stored values)', async () => {
    const first = await SettingsService.create(repo, bus)
    await first.set({
      'general.language': 'en',
      'preview.associations': { log: 'pch.preview.text' }
    })
    const second = await SettingsService.create(new SettingsRepo(db), bus)
    expect(second.get('general.language')).toBe('en')
    expect(second.get('preview.associations')).toEqual({ log: 'pch.preview.text' })
  })

  it('a partial update leaves other customized settings untouched', async () => {
    const service = await SettingsService.create(repo, bus)
    await service.set({ 'general.language': 'en' })
    await service.set({ 'appearance.accent': 'blue' })
    expect(service.get('general.language')).toBe('en')
    expect(await repo.getAll()).toEqual({ 'general.language': 'en', 'appearance.accent': 'blue' })
  })

  it('emits only the keys that actually changed', async () => {
    const service = await SettingsService.create(repo, bus)
    await service.set({ 'appearance.themeMode': 'dark', 'appearance.density': 'comfortable' })
    await service.set({ 'appearance.themeMode': 'dark' })
    expect(events).toEqual([{ 'appearance.themeMode': 'dark' }])
  })

  it('rejects invalid input with SETTINGS_INVALID and writes nothing', async () => {
    const service = await SettingsService.create(repo, bus)
    await expect(service.set({ 'appearance.themeMode': 'purple' })).rejects.toMatchObject({
      code: 'SETTINGS_INVALID'
    })
    await expect(service.set({ 'unknown.key': true })).rejects.toBeInstanceOf(AppError)
    expect(await repo.getAll()).toEqual({})
    expect(events).toEqual([])
  })

  it('ignores keys removed from the schema that linger in the database', async () => {
    await repo.upsert('launcher.officeDefaultAction', 'edit')
    await repo.upsert('launcher.officeExtensions', ['xlsx'])
    await repo.upsert('general.language', 'en')
    const service = await SettingsService.create(repo, bus)
    expect(service.getAll()).toEqual({ ...DEFAULT_SETTINGS, 'general.language': 'en' })
    expect(service.getAll()).not.toHaveProperty('launcher.officeDefaultAction')
  })
})
