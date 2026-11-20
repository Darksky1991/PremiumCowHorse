import { describe, expect, it, vi } from 'vitest'
import type { SearchResult } from '@pch/shared'
import { hasSearchTerms, runSearch, searchQuery } from './search'
import type { Invoke } from './vfs'

const EMPTY: SearchResult = {
  items: [],
  total: 0,
  truncated: false,
  indexedAt: null,
  incomplete: false
}

function fakeInvoke(): { invoke: Invoke; calls: { channel: string; input: unknown }[] } {
  const calls: { channel: string; input: unknown }[] = []
  const invoke = vi.fn(async (channel: string, input: unknown) => {
    calls.push({ channel, input })
    return channel === 'search.query' ? EMPTY : undefined
  }) as unknown as Invoke
  return { invoke, calls }
}

describe('runSearch', () => {
  it('sends search.query with a requestId and returns the result', async () => {
    const { invoke, calls } = fakeInvoke()
    const result = await runSearch(
      { workspaceId: 'w1', text: '設計 xlsx', kind: 'file' },
      new AbortController().signal,
      invoke
    )
    expect(result).toBe(EMPTY)
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({
      channel: 'search.query',
      input: { workspaceId: 'w1', text: '設計 xlsx', kind: 'file' }
    })
    expect((calls[0]!.input as { requestId: string }).requestId).toMatch(/^search:/)
  })

  it('每次查询使用不同的 requestId（取消只作用于该次查询，不会落到之后的新查询上）', async () => {
    const { invoke, calls } = fakeInvoke()
    const signal = new AbortController().signal
    await runSearch({ workspaceId: 'w1', text: 'a', kind: 'all' }, signal, invoke)
    await runSearch({ workspaceId: 'w1', text: 'a', kind: 'all' }, signal, invoke)
    const ids = calls.map((c) => (c.input as { requestId: string }).requestId)
    expect(new Set(ids).size).toBe(2)
  })

  it('signal 中止时以同一 requestId 发送 vfs.cancel', async () => {
    const calls: { channel: string; input: unknown }[] = []
    let resolveQuery: (r: SearchResult) => void = () => undefined
    const invoke = vi.fn((channel: string, input: unknown) => {
      calls.push({ channel, input })
      if (channel === 'search.query') {
        return new Promise<SearchResult>((r) => {
          resolveQuery = r
        })
      }
      return Promise.resolve(undefined)
    }) as unknown as Invoke
    const controller = new AbortController()
    const pending = runSearch(
      { workspaceId: 'w1', text: 'abc', kind: 'all' },
      controller.signal,
      invoke
    )
    controller.abort()
    resolveQuery(EMPTY)
    await pending
    const requestId = (calls[0]!.input as { requestId: string }).requestId
    expect(calls[1]).toEqual({ channel: 'vfs.cancel', input: { requestId } })
  })

  it('结束后中止不再发送 vfs.cancel', async () => {
    const { invoke, calls } = fakeInvoke()
    const controller = new AbortController()
    await runSearch({ workspaceId: 'w1', text: 'abc', kind: 'all' }, controller.signal, invoke)
    controller.abort()
    expect(calls.map((c) => c.channel)).toEqual(['search.query'])
  })
})

describe('searchQuery', () => {
  it("query key 为 ['search', workspaceId, text, kind]，staleTime 为 0", () => {
    const options = searchQuery('w1', 'abc', 'directory')
    expect(options.queryKey).toEqual(['search', 'w1', 'abc', 'directory'])
    expect(options.staleTime).toBe(0)
  })

  it('没有搜索词（空白）或没有工作区时不查询', () => {
    expect(searchQuery('w1', '   ', 'all').enabled).toBe(false)
    expect(searchQuery(undefined, 'abc', 'all').enabled).toBe(false)
    expect(searchQuery('w1', 'abc', 'all').enabled).toBe(true)
  })
})

describe('hasSearchTerms', () => {
  it('与主进程的 parseQuery 一致：空白不算搜索词', () => {
    expect(hasSearchTerms('')).toBe(false)
    expect(hasSearchTerms(' 　 ')).toBe(false)
    expect(hasSearchTerms(' a ')).toBe(true)
  })
})
