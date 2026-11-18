import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parseQuery, type SearchQuery, type SearchScope } from '@pch/shared'
import { Cache } from '../cache/cache'
import type { RawEntry } from '../enum/types'
import { search } from './search'

const file = (name: string, extra: Partial<RawEntry> = {}): RawEntry => ({
  name,
  kind: 'file',
  size: 10,
  mtime: 1000,
  hidden: false,
  ...extra
})
const dir = (name: string, extra: Partial<RawEntry> = {}): RawEntry => ({
  name,
  kind: 'directory',
  size: 0,
  mtime: 1000,
  hidden: false,
  ...extra
})

const A = 'file:///C:/a'
const B = 'file:///C:/ab'
const scopeA: SearchScope = { uri: A, entryId: 'ea', label: 'A' }
const scopeB: SearchScope = { uri: B, entryId: 'eb', label: 'B' }

function q(text: string, over: Partial<SearchQuery> = {}): SearchQuery {
  return {
    scopes: [scopeA],
    terms: parseQuery(text).terms,
    kind: 'all',
    showHidden: true,
    limit: 1000,
    ...over
  }
}
const names = (r: ReturnType<typeof search>): string[] => r.items.map((i) => i.name)
const sorted = (xs: string[]): string[] => [...xs].sort()

describe('search', () => {
  let cache: Cache
  beforeEach(() => {
    cache = Cache.open(':memory:')
    cache.setRoots([A, B, 'file:///C:/a/sub'])
    cache.applyListing(
      A,
      1,
      [
        file('設計書_第10章.xlsx'),
        file('設計書_第2章.xlsx'),
        file('readme.md'),
        file('.hidden-doc.txt', { hidden: true }),
        file('ab.txt'),
        dir('第10章'),
        dir('sub'),
        dir('日本語 フォルダ')
      ],
      500
    )
    cache.applyListing(
      `${A}/sub`,
      1,
      [file('設計書_sub.xlsx'), file('100%_done.txt'), file('under_score.txt'), file("it's.txt")],
      400
    )
    cache.applyListing(B, 1, [file('設計書_other.xlsx')], 300)
  })
  afterEach(() => cache.close())

  it('ANDs several terms (trigram + short term)', () => {
    expect(names(search(cache, q('設計書 第10章')))).toEqual(['設計書_第10章.xlsx'])
    expect(sorted(names(search(cache, q('設計書 xl'))))).toEqual(
      sorted(['設計書_sub.xlsx', '設計書_第10章.xlsx', '設計書_第2章.xlsx'])
    )
  })

  it('matches terms shorter than 3 characters by scanning', () => {
    expect(names(search(cache, q('ab')))).toEqual(['ab.txt'])
    expect(names(search(cache, q('第2')))).toEqual(['設計書_第2章.xlsx'])
  })

  it('is case-insensitive', () => {
    expect(names(search(cache, q('README')))).toEqual(['readme.md'])
  })

  it('matches wildcards over the whole name', () => {
    expect(sorted(names(search(cache, q('*.xlsx'))))).toEqual(
      sorted(['設計書_sub.xlsx', '設計書_第10章.xlsx', '設計書_第2章.xlsx'])
    )
    expect(names(search(cache, q('設計書_第?章.xlsx')))).toEqual(['設計書_第2章.xlsx'])
    expect(names(search(cache, q('READ*')))).toEqual(['readme.md'])
    expect(names(search(cache, q('read*')))).toEqual(['readme.md'])
    expect(names(search(cache, q('ead*')))).toEqual([])
  })

  it('treats LIKE / GLOB / FTS special characters literally', () => {
    expect(names(search(cache, q('100%')))).toEqual(['100%_done.txt'])
    expect(names(search(cache, q('_score')))).toEqual(['under_score.txt'])
    expect(names(search(cache, q('"')))).toEqual([])
    expect(names(search(cache, q("it's")))).toEqual(["it's.txt"])
    expect(names(search(cache, q('"it')))).toEqual([])
    expect(names(search(cache, q('[ab]*')))).toEqual([])
  })

  it('filters hidden entries unless showHidden', () => {
    expect(names(search(cache, q('hidden-doc')))).toEqual(['.hidden-doc.txt'])
    expect(names(search(cache, q('hidden-doc', { showHidden: false })))).toEqual([])
  })

  it('filters by kind', () => {
    expect(names(search(cache, q('第10章', { kind: 'directory' })))).toEqual(['第10章'])
    expect(names(search(cache, q('第10章', { kind: 'file' })))).toEqual(['設計書_第10章.xlsx'])
    expect(search(cache, q('第10章', { kind: 'all' })).items).toHaveLength(2)
  })

  it('treats a symlink to a directory as a directory for the kind filter', () => {
    cache.applyListing(
      B,
      1,
      [
        dir('x'),
        { name: 'link', kind: 'symlink', size: 0, mtime: 1, hidden: false, target: 'directory' }
      ],
      1
    )
    expect(names(search(cache, q('lin', { scopes: [scopeB], kind: 'directory' })))).toEqual([
      'link'
    ])
    expect(names(search(cache, q('lin', { scopes: [scopeB], kind: 'file' })))).toEqual([])
  })

  it('keeps broken symlinks (target null) for the file filter and out of the directory filter', () => {
    cache.applyListing(
      B,
      1,
      [{ name: 'broken-link', kind: 'symlink', size: 0, mtime: 1, hidden: false }],
      1
    )
    expect(names(search(cache, q('broken', { scopes: [scopeB], kind: 'file' })))).toEqual([
      'broken-link'
    ])
    expect(names(search(cache, q('broken', { scopes: [scopeB], kind: 'directory' })))).toEqual([])
    expect(names(search(cache, q('broken', { scopes: [scopeB], kind: 'all' })))).toEqual([
      'broken-link'
    ])
  })

  it('limits scope by URI prefix (C:/a does not include C:/ab)', () => {
    expect(search(cache, q('設計書_other')).items).toEqual([])
    const both = search(cache, q('設計書_other', { scopes: [scopeA, scopeB] }))
    expect(names(both)).toEqual(['設計書_other.xlsx'])
    expect(both.items[0]?.entryId).toBe('eb')
  })

  it('handles drive-root scopes', () => {
    cache.setRoots(['file:///C:/', A])
    cache.applyListing('file:///C:/', 1, [file('rootfile.txt')], 1)
    const s: SearchScope = { uri: 'file:///C:/', entryId: 'ec', label: 'C' }
    const r = search(cache, q('rootfile', { scopes: [s] }))
    expect(r.items[0]?.uri).toBe('file:///C:/rootfile.txt')
    expect(r.items[0]?.relativePath).toBe('rootfile.txt')
  })

  it('fills uri, relativePath (decoded, slash separated) and the longest-prefix entry id', () => {
    const nested: SearchScope = { uri: `${A}/sub`, entryId: 'esub', label: 'sub' }
    const r = search(cache, q('設計書_sub', { scopes: [scopeA, nested] }))
    expect(r.items).toHaveLength(1)
    const hit = r.items[0]!
    expect(hit.entryId).toBe('esub')
    expect(hit.relativePath).toBe('設計書_sub.xlsx')
    expect(hit.uri).toBe(`${A}/sub/${encodeURIComponent('設計書_sub.xlsx')}`)
    const viaA = search(cache, q('設計書_sub'))
    expect(viaA.items[0]?.entryId).toBe('ea')
    expect(viaA.items[0]?.relativePath).toBe('sub/設計書_sub.xlsx')
  })

  it('returns nothing without terms or scopes', () => {
    expect(search(cache, q('')).items).toEqual([])
    expect(search(cache, q('abc', { scopes: [] })).items).toEqual([])
  })

  it('applies limit, reports total and truncated', () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      file(`item-${String(i).padStart(2, '0')}.txt`)
    )
    cache.applyListing(B, 1, many, 1)
    const r = search(cache, q('item-', { scopes: [scopeB], limit: 10 }))
    expect(r.items).toHaveLength(10)
    expect(r.total).toBe(30)
    expect(r.truncated).toBe(true)
    const all = search(cache, q('item-', { scopes: [scopeB], limit: 100 }))
    expect(all.truncated).toBe(false)
    expect(all.total).toBe(30)
  })

  it('sorts names starting with the first term first, then by name', () => {
    cache.applyListing(
      B,
      1,
      [file('zzreport.txt'), file('report-b.txt'), file('aareport.txt'), file('report-a.txt')],
      1
    )
    expect(names(search(cache, q('report', { scopes: [scopeB] })))).toEqual([
      'report-a.txt',
      'report-b.txt',
      'aareport.txt',
      'zzreport.txt'
    ])
  })

  it('reports indexedAt as the oldest checked_at and incomplete for never-listed directories', () => {
    const r = search(cache, q('readme'))
    expect(r.indexedAt).toBe(400)
    expect(r.incomplete).toBe(true) // 子目录「第10章」等有行但从未列出
    const subScope: SearchScope = { uri: `${A}/sub`, entryId: 'x', label: 'x' }
    const sub = search(cache, q('readme', { scopes: [subScope] }))
    expect(sub.indexedAt).toBe(400)
    expect(sub.incomplete).toBe(false)
    expect(search(cache, q('readme', { scopes: [] })).indexedAt).toBeNull()
  })

  it('caps total at 10000 and stays fast over 100k names', () => {
    const root = 'file:///D:/big'
    cache.setRoots([root])
    const words = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta', 'theta']
    for (let d = 0; d < 100; d++) {
      const entries: RawEntry[] = []
      for (let i = 0; i < 1000; i++) {
        entries.push(file(`${words[(d + i) % words.length]}_${d}_${i}_${(i * 7919) % 100003}.dat`))
      }
      cache.applyListing(d === 0 ? root : `${root}/d${d}`, 1, entries, 1)
    }
    const s: SearchScope = { uri: root, entryId: 'big', label: 'big' }
    const timings: Record<string, number> = {}
    const time = (label: string, text: string): ReturnType<typeof search> => {
      const t0 = performance.now()
      const r = search(cache, q(text, { scopes: [s] }))
      timings[label] = Math.round(performance.now() - t0)
      return r
    }
    const capped = time('3+ chars, 12.5k hits', 'alpha')
    expect(capped.items).toHaveLength(1000)
    expect(capped.total).toBe(10000)
    expect(capped.truncated).toBe(true)
    const rare = time('3+ chars, few hits', 'theta_77_5')
    expect(rare.total).toBeGreaterThan(0)
    time('3+ chars two terms', 'alpha 77_')
    time('short term (2 chars)', 'zz')
    time('short term (2 chars, many hits)', '_7')
    time('glob', 'alpha_5*.dat')
    time('glob + 3+ chars', '*.dat gamma')
    console.log('search timings (ms) over 100k names:', JSON.stringify(timings))
    for (const ms of Object.values(timings)) expect(ms).toBeLessThan(2000)
  }, 120_000)
})
