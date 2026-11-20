import { describe, expect, it, vi } from 'vitest'
import type { SearchHit, SearchResult, WorkspaceEntry } from '@pch/shared'
import { searchHandlers, type SearchScannerApi } from './search.ipc'

const ctx = { senderId: 1 }
const entry = (
  e: Partial<WorkspaceEntry> & Pick<WorkspaceEntry, 'id' | 'kind'>
): WorkspaceEntry => ({
  workspaceId: 'w',
  parentId: null,
  label: e.id,
  uri: null,
  sortOrder: 0,
  meta: null,
  cacheStrategy: null,
  createdAt: 0,
  updatedAt: 0,
  ...e
})
const hit = (uri: string, name: string): SearchHit => ({
  uri,
  name,
  kind: 'file',
  size: 1,
  mtime: 1,
  hidden: false,
  entryId: 'f1',
  relativePath: name
})
const scanned = (items: SearchHit[], total = items.length): SearchResult => ({
  items,
  total,
  truncated: false,
  indexedAt: 5,
  incomplete: true
})

function setup(
  entries: WorkspaceEntry[],
  result: SearchResult = scanned([])
): {
  handlers: ReturnType<typeof searchHandlers>
  search: ReturnType<typeof vi.fn>
  cancelSearch: ReturnType<typeof vi.fn>
} {
  const search = vi.fn(async () => result)
  const cancelSearch = vi.fn()
  const scanner = { search, cancelSearch } as unknown as SearchScannerApi
  const handlers = searchHandlers(
    { listEntries: async () => entries },
    { get: () => true } as never,
    scanner
  )
  return { handlers, search, cancelSearch }
}

const base = { workspaceId: 'w', kind: 'all' as const, requestId: 'r1' }
const folder = entry({ id: 'f1', kind: 'folder', uri: 'file:///C:/a', label: 'A' })

describe('search.query', () => {
  it('builds scopes from folder entries (not groups / files) and passes showHidden and requestId', async () => {
    const { handlers, search } = setup([
      entry({ id: 'g', kind: 'group' }),
      folder,
      entry({ id: 'x', kind: 'file', uri: 'file:///C:/z.txt' })
    ])
    await handlers['search.query']({ ...base, text: 'abc', limit: 50 }, ctx)
    expect(search).toHaveBeenCalledWith(
      {
        scopes: [{ uri: 'file:///C:/a', entryId: 'f1', label: 'A' }],
        terms: [{ kind: 'contains', value: 'abc' }],
        kind: 'all',
        showHidden: true,
        limit: 50
      },
      'r1'
    )
  })

  it('defaults the limit to 1000', async () => {
    const { handlers, search } = setup([folder])
    await handlers['search.query']({ ...base, text: 'abc' }, ctx)
    expect(search.mock.calls[0]![0]).toMatchObject({ limit: 1000 })
  })

  it('merges pinned file entries by name first, with an empty relativePath', async () => {
    const pinnedUri = 'file:///D:/docs/%E8%A8%AD%E8%A8%88abc.txt'
    const { handlers } = setup(
      [
        folder,
        entry({ id: 'p', kind: 'file', uri: pinnedUri }),
        entry({ id: 'q', kind: 'file', uri: 'file:///D:/docs/other.txt' })
      ],
      scanned([hit('file:///C:/a/abc.txt', 'abc.txt')])
    )
    const r = await handlers['search.query']({ ...base, text: 'ABC' }, ctx)
    expect(r.items.map((i) => i.name)).toEqual(['設計abc.txt', 'abc.txt'])
    expect(r.items[0]).toMatchObject({
      entryId: 'p',
      relativePath: '',
      kind: 'file',
      uri: pinnedUri
    })
    expect(r.total).toBe(2)
    expect(r.indexedAt).toBe(5)
    expect(r.incomplete).toBe(true)
  })

  it('does not match pinned files for the directory filter and shows a pinned file once', async () => {
    const pinned = entry({ id: 'p', kind: 'file', uri: 'file:///C:/a/abc.txt' })
    const dirOnly = setup([folder, pinned])
    const r1 = await dirOnly.handlers['search.query'](
      { ...base, kind: 'directory', text: 'abc' },
      ctx
    )
    expect(r1.items).toEqual([])
    const both = setup([folder, pinned], scanned([hit('file:///C:/a/abc.txt', 'abc.txt')]))
    const r2 = await both.handlers['search.query']({ ...base, text: 'abc' }, ctx)
    expect(r2.items).toHaveLength(1)
    expect(r2.items[0]!.entryId).toBe('p')
    expect(r2.total).toBe(1)
  })

  it('only pinned files: works without calling the scanner', async () => {
    const { handlers, search, cancelSearch } = setup([
      entry({ id: 'p', kind: 'file', uri: 'file:///C:/abc.txt' })
    ])
    const r = await handlers['search.query']({ ...base, text: 'abc' }, ctx)
    expect(r.items).toHaveLength(1)
    expect(search).not.toHaveBeenCalled()
    expect(cancelSearch).toHaveBeenCalledWith('r1')
  })

  it('empty text returns an empty result and cancels the previous query', async () => {
    const { handlers, search, cancelSearch } = setup([folder])
    const r = await handlers['search.query']({ ...base, text: '  ' }, ctx)
    expect(r).toEqual({ items: [], total: 0, truncated: false, indexedAt: null, incomplete: false })
    expect(search).not.toHaveBeenCalled()
    expect(cancelSearch).toHaveBeenCalledWith('r1')
  })

  it('applies the limit to merged items and caps total at 10000', async () => {
    const { handlers } = setup(
      [folder, entry({ id: 'p', kind: 'file', uri: 'file:///C:/abc.txt' })],
      scanned(
        [hit('file:///C:/a/abc1.txt', 'abc1.txt'), hit('file:///C:/a/abc2.txt', 'abc2.txt')],
        10000
      )
    )
    const r = await handlers['search.query']({ ...base, text: 'abc', limit: 2 }, ctx)
    expect(r.items.map((i) => i.name)).toEqual(['abc.txt', 'abc1.txt'])
    expect(r.total).toBe(10000)
    expect(r.truncated).toBe(true)
  })

  it('propagates scanner errors (INDEX_UNAVAILABLE)', async () => {
    const { handlers, search } = setup([folder])
    search.mockRejectedValueOnce(new Error('INDEX_UNAVAILABLE'))
    await expect(handlers['search.query']({ ...base, text: 'abc' }, ctx)).rejects.toThrow(
      'INDEX_UNAVAILABLE'
    )
  })
})
