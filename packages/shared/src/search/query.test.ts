import { describe, expect, it } from 'vitest'
import { matchRanges, matchesName, parseQuery } from './query'

describe('parseQuery', () => {
  it('splits on whitespace into AND terms', () => {
    expect(parseQuery('設計書  第10章\t xlsx').terms).toEqual([
      { kind: 'contains', value: '設計書' },
      { kind: 'contains', value: '第10章' },
      { kind: 'contains', value: 'xlsx' }
    ])
  })
  it('treats terms with * or ? as glob', () => {
    expect(parseQuery('*.xlsx 第?章 abc').terms.map((t) => t.kind)).toEqual([
      'glob',
      'glob',
      'contains'
    ])
  })
  it('returns no terms for empty or blank input', () => {
    expect(parseQuery('').terms).toEqual([])
    expect(parseQuery('  　 ').terms).toEqual([])
  })
})

describe('matchesName', () => {
  const t = (s: string): ReturnType<typeof parseQuery>['terms'] => parseQuery(s).terms
  it('matches contains case-insensitively and ANDs terms', () => {
    expect(matchesName('Design_Doc.XLSX', t('design xlsx'))).toBe(true)
    expect(matchesName('Design_Doc.XLSX', t('design pdf'))).toBe(false)
  })
  it('matches globs against the whole name', () => {
    expect(matchesName('a.xlsx', t('*.XLSX'))).toBe(true)
    expect(matchesName('a.xlsx.bak', t('*.xlsx'))).toBe(false)
    expect(matchesName('第3章', t('第?章'))).toBe(true)
    expect(matchesName('第10章', t('第?章'))).toBe(false)
  })
  it('treats regex and bracket characters literally', () => {
    expect(matchesName('a[1].txt', t('a[1]*'))).toBe(true)
    expect(matchesName('a1.txt', t('a[1]*'))).toBe(false)
    expect(matchesName('a(b).txt', t('a(b)*'))).toBe(true)
  })
  it('matches nothing without terms', () => {
    expect(matchesName('x', [])).toBe(false)
  })
})

describe('matchRanges', () => {
  const t = (s: string): ReturnType<typeof parseQuery>['terms'] => parseQuery(s).terms
  it('marks every case-insensitive occurrence of contains terms, merged and sorted', () => {
    expect(matchRanges('Design_design.XLSX', t('design xlsx'))).toEqual([
      { start: 0, end: 6 },
      { start: 7, end: 13 },
      { start: 14, end: 18 }
    ])
    // 重叠的词合并成一段
    expect(matchRanges('設計書_第10章', t('設計 計書'))).toEqual([{ start: 0, end: 3 }])
  })
  it('marks the literal parts of a glob, not the wildcards', () => {
    expect(matchRanges('仕様書.xlsx', t('仕様*.XLSX'))).toEqual([
      { start: 0, end: 2 },
      { start: 3, end: 8 }
    ])
    expect(matchRanges('第3章', t('第?章'))).toEqual([
      { start: 0, end: 1 },
      { start: 2, end: 3 }
    ])
    expect(matchRanges('a[1].txt', t('a[1]*'))).toEqual([{ start: 0, end: 4 }])
  })
  it('returns no ranges when the name does not match', () => {
    expect(matchRanges('abc', t('xyz'))).toEqual([])
    expect(matchRanges('a.xlsx.bak', t('*.xlsx'))).toEqual([])
    expect(matchRanges('abc', [])).toEqual([])
  })
  it('skips contains highlighting when lower-casing changes the length', () => {
    // 'İ'.toLowerCase() 为 2 个 UTF-16 单元，下标无法对应回原名称
    expect(matchRanges('İstanbul', t('stan'))).toEqual([])
  })
})
