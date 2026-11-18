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
