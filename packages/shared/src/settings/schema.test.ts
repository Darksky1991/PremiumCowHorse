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
      'refresh.defaultLevel.local': 'active',
      'refresh.defaultLevel.network': 'default',
      'refresh.activeDepth': 3,
      'refresh.intervalSec.local': 5,
      'refresh.intervalSec.network': 30,
      'refresh.backgroundIntervalMin': 10,
      'vfs.timeoutSec.local': 5,
      'vfs.timeoutSec.network': 10
    })
    expect(Object.hasOwn(DEFAULT_SETTINGS, 'remote.pollIntervalSec')).toBe(false)
  })

  it.each([
    ['refresh.defaultLevel.local', 'sometimes'],
    ['refresh.activeDepth', 0],
    ['refresh.activeDepth', 11],
    ['refresh.intervalSec.local', 1],
    ['refresh.intervalSec.network', 9],
    ['refresh.backgroundIntervalMin', 0],
    ['vfs.timeoutSec.local', 0],
    ['vfs.timeoutSec.local', 61],
    ['vfs.timeoutSec.network', 9],
    ['vfs.timeoutSec.network', 121],
    ['remote.pollIntervalSec', 0]
  ] as const)('拒绝 %s = %j', (key, value) => {
    expect(SettingsPatch.safeParse({ [key]: value }).success).toBe(false)
  })

  it.each([
    ['refresh.defaultLevel.network', 'all'],
    ['refresh.activeDepth', 10],
    ['refresh.intervalSec.local', 2],
    ['refresh.intervalSec.network', 10],
    ['refresh.backgroundIntervalMin', 1],
    ['vfs.timeoutSec.local', 60],
    ['vfs.timeoutSec.network', 120]
  ] as const)('接受边界值 %s = %j', (key, value) => {
    expect(SettingsPatch.safeParse({ [key]: value }).success).toBe(true)
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
