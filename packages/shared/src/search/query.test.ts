import { describe, expect, it } from 'vitest'
import { matchesName, parseQuery } from './query'

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
