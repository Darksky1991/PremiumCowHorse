import { describe, expect, it } from 'vitest'
import { ENCODING_LABELS } from './types'
import { loadFixtures } from './fixtures.test-helper'

const fixtures = loadFixtures()

describe('编码样本集', () => {
  it('manifest 结构有效，覆盖全部 9 个标签与各语言', () => {
    expect(fixtures.length).toBeGreaterThan(100)
    const labels = new Set(fixtures.map((f) => f.entry.label))
    for (const label of ENCODING_LABELS) {
      expect(labels.has(label), label).toBe(true)
    }
    const langs = new Set(fixtures.map((f) => f.entry.lang))
    expect([...langs].sort()).toEqual(['en', 'ja', 'mixed', 'zh-CN', 'zh-TW'])
    expect(new Set(fixtures.map((f) => f.entry.file)).size).toBe(fixtures.length)
    expect(fixtures.some((f) => f.entry.ambiguous)).toBe(true)
  })

  it('总量小于 3MB', () => {
    const total = fixtures.reduce(
      (sum, f) => sum + f.bytes.length + new TextEncoder().encode(f.text).length,
      0
    )
    expect(total).toBeLessThan(3 * 1024 * 1024)
  })

  it.each(fixtures.map((f) => [f.entry.file, f] as const))(
    '%s：按 label 解码等于原文，acceptable 都成立',
    (_, f) => {
      expect(new TextDecoder(f.entry.label).decode(f.bytes)).toBe(f.text)
      expect(f.entry.acceptable).toContain(f.entry.label)
      for (const label of f.entry.acceptable) {
        expect(new TextDecoder(label).decode(f.bytes), label).toBe(f.text)
      }
    }
  )
})
