import { describe, expect, it } from 'vitest'
import { settingsSchema, type SettingKey } from '@pch/shared'
import { SETTINGS_SECTIONS } from './sections'
import { describeField, validateSetting } from './validate'

describe('validateSetting', () => {
  it('rejects a number below the schema minimum', () => {
    const result = validateSetting('remote.keepaliveSec', 4)
    expect(result).toEqual({ ok: false, message: 'range' })
  })

  it('accepts a number inside the range', () => {
    expect(validateSetting('remote.keepaliveSec', 15)).toEqual({ ok: true, value: 15 })
  })

  it('converts a numeric string typed into an input', () => {
    expect(validateSetting('cache.activeDepth', '3')).toEqual({ ok: true, value: 3 })
  })

  it('rejects an empty, non-numeric or fractional input', () => {
    expect(validateSetting('cache.activeDepth', '')).toEqual({ ok: false, message: 'required' })
    expect(validateSetting('cache.activeDepth', 'abc')).toEqual({ ok: false, message: 'invalid' })
    expect(validateSetting('cache.activeDepth', '2.5')).toEqual({ ok: false, message: 'integer' })
  })

  it('accepts enum values and rejects unknown ones', () => {
    expect(validateSetting('appearance.theme', 'washi')).toEqual({ ok: true, value: 'washi' })
    expect(validateSetting('appearance.theme', 'nope').ok).toBe(false)
  })
})

describe('describeField', () => {
  it('reads the type, options and bounds from the schema', () => {
    expect(describeField('explorer.showHiddenFiles')).toEqual({ type: 'boolean' })
    expect(describeField('appearance.theme')).toMatchObject({
      type: 'enum',
      options: ['default', 'aitetsu', 'washi', 'matsuba']
    })
    expect(describeField('remote.keepaliveSec')).toEqual({ type: 'number', min: 5, max: 120 })
    // 没有上限的数值项 max 为 undefined
    expect(describeField('cache.interval.focus.local')).toEqual({
      type: 'number',
      min: 2,
      max: undefined
    })
  })
})

describe('SETTINGS_SECTIONS', () => {
  // 不在设置页显示的键：没有代码读取的 3 个、界面记忆 1 个，以及用单独列表控件的文件关联
  const HIDDEN: SettingKey[] = [
    'session.restoreOnStartup',
    'window.onDetachedClose',
    'launcher.autoUploadRemoteEdits',
    'remote.cacheSizeMB',
    'workspace.pickerView'
  ]

  it('covers every schema key except the hidden keys and the associations list', () => {
    const covered = new Set<string>(SETTINGS_SECTIONS.flatMap((s) => s.keys))
    const missing = Object.keys(settingsSchema.shape).filter(
      (k) => !covered.has(k) && !HIDDEN.includes(k as SettingKey) && k !== 'preview.associations'
    )
    expect(missing).toEqual([])
  })

  it('never lists a hidden key, the associations list, or a key twice', () => {
    const all = SETTINGS_SECTIONS.flatMap((s) => [...s.keys]) as string[]
    for (const k of [...HIDDEN, 'preview.associations']) expect(all).not.toContain(k)
    expect(new Set(all).size).toBe(all.length)
  })
})
