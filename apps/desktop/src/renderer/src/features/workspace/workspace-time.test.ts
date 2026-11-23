import { describe, expect, it } from 'vitest'
import { lastUsedText, relativeTime } from './workspace-time'

const NOW = Date.UTC(2026, 10, 23, 12, 0, 0)
const MIN = 60_000

describe('relativeTime', () => {
  it('returns null under a minute (and for times in the future)', () => {
    expect(relativeTime(NOW - 30_000, NOW, 'ja')).toBeNull()
    expect(relativeTime(NOW + 5 * MIN, NOW, 'ja')).toBeNull()
  })

  it('uses minutes, hours, days (yesterday) and months', () => {
    expect(relativeTime(NOW - 5 * MIN, NOW, 'ja')).toBe('5 分前')
    expect(relativeTime(NOW - 2 * 60 * MIN, NOW, 'ja')).toBe('2 時間前')
    expect(relativeTime(NOW - 25 * 60 * MIN, NOW, 'ja')).toBe('昨日')
    expect(relativeTime(NOW - 3 * 24 * 60 * MIN, NOW, 'en')).toBe('3 days ago')
    expect(relativeTime(NOW - 65 * 24 * 60 * MIN, NOW, 'en')).toBe('2 months ago')
  })
})

describe('lastUsedText', () => {
  const t = (key: string): string => `<${key}>`
  it('says never used / just now when there is no relative time', () => {
    expect(lastUsedText(null, NOW, 'ja', t)).toBe('<neverUsed>')
    expect(lastUsedText(NOW - 1000, NOW, 'ja', t)).toBe('<justNow>')
    expect(lastUsedText(NOW - 5 * MIN, NOW, 'ja', t)).toBe('5 分前')
  })
})
