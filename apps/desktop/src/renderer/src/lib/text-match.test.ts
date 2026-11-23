import { describe, expect, it } from 'vitest'
import { matchScore, normalizeForMatch } from './text-match'

describe('normalizeForMatch', () => {
  it('folds half-width katakana into full-width', () => {
    expect(normalizeForMatch('ﾊﾞｯﾁ')).toBe(normalizeForMatch('バッチ'))
  })
  it('folds hiragana into katakana', () => {
    expect(normalizeForMatch('ばっち')).toBe(normalizeForMatch('バッチ'))
  })
  it('lowercases and folds full-width latin', () => {
    expect(normalizeForMatch('ＷＭＳ')).toBe('wms')
  })
})

describe('matchScore', () => {
  it('scores name prefix 3, name contains 2, description contains 1', () => {
    expect(matchScore('bat', 'Batch job')).toBe(3)
    expect(matchScore('job', 'Batch job')).toBe(2)
    expect(matchScore('wms', 'x', '物流 WMS')).toBe(1)
  })
  it('returns null when nothing matches', () => {
    expect(matchScore('zz', 'x')).toBeNull()
    expect(matchScore('zz', 'x', 'desc')).toBeNull()
  })
  it('matches hiragana queries against katakana names', () => {
    expect(matchScore('ばっち', 'バッチ処理')).toBe(3)
  })
  it('trims the query', () => {
    expect(matchScore('  bat ', 'Batch')).toBe(3)
  })
})
