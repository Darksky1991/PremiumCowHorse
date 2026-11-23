import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, SettingsPatch, resolveLanguage, resolveSettings } from './schema'

describe('resolveSettings', () => {
  it('returns defaults when nothing is stored', () => {
    expect(resolveSettings({})).toEqual(DEFAULT_SETTINGS)
  })

  it('overlays valid stored values on defaults', () => {
    const s = resolveSettings({ 'appearance.themeMode': 'dark', 'preview.maxTextSizeMB': 10 })
    expect(s['appearance.themeMode']).toBe('dark')
    expect(s['preview.maxTextSizeMB']).toBe(10)
    expect(s['general.language']).toBe('system')
  })

  it('falls back to the default for an invalid stored value without affecting other keys', () => {
    const s = resolveSettings({ 'appearance.themeMode': 'purple', 'appearance.accent': 'blue' })
    expect(s['appearance.themeMode']).toBe(DEFAULT_SETTINGS['appearance.themeMode'])
    expect(s['appearance.accent']).toBe('blue')
  })

  it('ignores unknown keys left by older versions', () => {
    expect(resolveSettings({ 'legacy.option': true })).toEqual(DEFAULT_SETTINGS)
  })
})

describe('M5 appearance and picker settings', () => {
  it('has the documented defaults', () => {
    const s = resolveSettings({})
    expect(s['appearance.theme']).toBe('default')
    expect(s['appearance.reduceMotion']).toBe('system')
    expect(s['workspace.pickerStyle']).toBe('carousel')
    expect(s['workspace.pickerDetail']).toBe(false)
    expect(s['workspace.pickerView']).toBe('ring')
  })

  it('rejects an unknown theme and falls back to the default', () => {
    expect(SettingsPatch.safeParse({ 'appearance.theme': 'neon' }).success).toBe(false)
    expect(resolveSettings({ 'appearance.theme': 'neon' })['appearance.theme']).toBe('default')
    expect(SettingsPatch.safeParse({ 'appearance.theme': 'washi' }).success).toBe(true)
  })
})

describe('SettingsPatch', () => {
  it('rejects unknown keys', () => {
    expect(SettingsPatch.safeParse({ 'nope.key': 1 }).success).toBe(false)
  })

  it('rejects out-of-range values', () => {
    expect(SettingsPatch.safeParse({ 'preview.maxTextSizeMB': 0 }).success).toBe(false)
  })

  it('does not fill in defaults for keys that were not sent', () => {
    expect(SettingsPatch.parse({ 'appearance.accent': 'green' })).toEqual({
      'appearance.accent': 'green'
    })
  })
})

describe('刷新与超时的设置（设计 4.9）', () => {
  it('默认值', () => {
    expect(DEFAULT_SETTINGS).toMatchObject({
      'cache.strategy.local': 'active',
      'cache.strategy.network': 'default',
      'cache.activeDepth': 3,
      'cache.interval.focus.local': 5,
      'cache.interval.focus.network': 10,
      'cache.interval.near.local': 30,
      'cache.interval.near.network': 60,
      'cache.interval.far.local': 120,
      'cache.interval.far.network': 300,
      'cache.backgroundGapMs.local': 500,
      'cache.backgroundGapMs.network': 2000,
      'vfs.timeoutSec.local': 5,
      'vfs.timeoutSec.network': 10
    })
    expect(Object.hasOwn(DEFAULT_SETTINGS, 'remote.pollIntervalSec')).toBe(false)
  })

  it.each([
    ['cache.strategy.local', 'sometimes'],
    ['cache.activeDepth', 0],
    ['cache.activeDepth', 11],
    ['cache.interval.focus.local', 1],
    ['cache.interval.focus.network', 9],
    ['cache.interval.near.local', 1],
    ['cache.interval.near.network', 9],
    ['cache.interval.far.local', 1],
    ['cache.interval.far.network', 9],
    ['cache.backgroundGapMs.local', 99],
    ['cache.backgroundGapMs.network', 499],
    ['vfs.timeoutSec.local', 0],
    ['vfs.timeoutSec.local', 61],
    ['vfs.timeoutSec.network', 9],
    ['vfs.timeoutSec.network', 121],
    ['remote.pollIntervalSec', 0]
  ] as const)('拒绝 %s = %j', (key, value) => {
    expect(SettingsPatch.safeParse({ [key]: value }).success).toBe(false)
  })

  it.each([
    ['cache.strategy.network', 'all'],
    ['cache.activeDepth', 10],
    ['cache.interval.focus.local', 2],
    ['cache.interval.focus.network', 10],
    ['cache.interval.near.local', 2],
    ['cache.interval.far.network', 10],
    ['cache.backgroundGapMs.local', 100],
    ['cache.backgroundGapMs.network', 500],
    ['vfs.timeoutSec.local', 60],
    ['vfs.timeoutSec.network', 120]
  ] as const)('接受边界值 %s = %j', (key, value) => {
    expect(SettingsPatch.safeParse({ [key]: value }).success).toBe(true)
  })
})

describe('旧版本残留的 refresh.* 键', () => {
  it('resolveSettings 忽略它们且不报错', () => {
    const s = resolveSettings({
      'refresh.defaultLevel.local': 'all',
      'refresh.intervalSec.local': 2,
      'cache.strategy.local': 'passive'
    })
    expect(s['cache.strategy.local']).toBe('passive')
    expect(Object.keys(s).some((k) => k.startsWith('refresh.'))).toBe(false)
  })
})

describe('resolveLanguage', () => {
  it.each([
    ['ja-JP', 'ja'],
    ['ja', 'ja'],
    ['zh-CN', 'zh-CN'],
    ['zh-TW', 'zh-CN'],
    ['en-US', 'en'],
    ['fr-FR', 'en']
  ] as const)('maps system locale %s to %s', (locale, expected) => {
    expect(resolveLanguage('system', locale)).toBe(expected)
  })

  it('uses an explicit setting regardless of system locale', () => {
    expect(resolveLanguage('en', 'ja-JP')).toBe('en')
  })
})
