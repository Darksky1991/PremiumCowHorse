import { describe, expect, it } from 'vitest'
import { createI18n, resources } from './index'

/** 编译期已由 Resource 类型保证键一致；这里再防止出现空文案 */
function flatten(obj: object, prefix = ''): Record<string, string> {
  return Object.entries(obj).reduce<Record<string, string>>((acc, [k, v]) => {
    const key = prefix ? `${prefix}.${k}` : k
    return typeof v === 'string' ? { ...acc, [key]: v } : { ...acc, ...flatten(v, key) }
  }, {})
}

describe('locale resources', () => {
  const ja = flatten(resources.ja)

  it.each(Object.keys(resources))('%s has the same keys as ja and no empty strings', (lang) => {
    const flat = flatten(resources[lang as keyof typeof resources])
    expect(Object.keys(flat).sort()).toEqual(Object.keys(ja).sort())
    for (const [key, value] of Object.entries(flat)) expect(value.trim(), key).not.toBe('')
  })

  it('creates a synchronously initialized instance', () => {
    const i18n = createI18n('zh-CN')
    expect(i18n.t('explorer')).toBe('资源管理器')
    expect(i18n.t('errors:IPC_BAD_INPUT')).toBe('输入内容不正确')
  })
})
