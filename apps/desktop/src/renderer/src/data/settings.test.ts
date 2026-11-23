import { QueryClient } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Settings } from '@pch/shared'
import { queryKeys } from '@renderer/lib/query-keys'
import { settingsMutationHandlers } from './settings'

const base = {
  'appearance.theme': 'default',
  'general.language': 'ja',
  'preview.associations': {}
} as unknown as Settings

describe('settingsMutationHandlers', () => {
  let client: QueryClient
  let h: ReturnType<typeof settingsMutationHandlers>
  const cache = (): Record<string, unknown> =>
    client.getQueryData<Settings>(queryKeys.settings) as unknown as Record<string, unknown>
  const err = new Error('x')

  beforeEach(() => {
    client = new QueryClient()
    client.setQueryData(queryKeys.settings, base)
    h = settingsMutationHandlers(client)
  })

  it('merges optimistically and rolls a single failed write back', () => {
    const patch = { 'appearance.theme': 'washi' } as never
    const ctx = h.onMutate(patch)
    expect(cache()['appearance.theme']).toBe('washi')
    h.onError(err, patch, ctx)
    expect(cache()['appearance.theme']).toBe('default')
  })

  it('first write fails, second (same key) keeps its optimistic value', () => {
    const p1 = { 'appearance.theme': 'washi' } as never
    const p2 = { 'appearance.theme': 'matsuba' } as never
    const c1 = h.onMutate(p1)
    h.onMutate(p2)
    h.onError(err, p1, c1)
    expect(cache()['appearance.theme']).toBe('matsuba')
  })

  it('does not touch other keys when rolling back', () => {
    const p1 = { 'appearance.theme': 'washi' } as never
    const p2 = { 'general.language': 'en' } as never
    const c1 = h.onMutate(p1)
    h.onMutate(p2)
    h.onError(err, p1, c1)
    expect(cache()['appearance.theme']).toBe('default')
    expect(cache()['general.language']).toBe('en')
  })

  it('a broadcast arriving during the write survives the failure', () => {
    const p1 = { 'appearance.theme': 'washi' } as never
    const c1 = h.onMutate(p1)
    client.setQueryData(queryKeys.settings, { ...cache(), 'appearance.theme': 'aitetsu' })
    h.onError(err, p1, c1)
    expect(cache()['appearance.theme']).toBe('aitetsu')
  })

  it('compares object values by content: a broadcast with an equal new object is still rolled back', () => {
    const p1 = { 'preview.associations': { txt: 'a' } } as never
    const c1 = h.onMutate(p1)
    client.setQueryData(queryKeys.settings, {
      ...cache(),
      'preview.associations': { txt: 'a' }
    })
    h.onError(err, p1, c1)
    expect(cache()['preview.associations']).toEqual({})
  })

  describe('refetch after a failure (server is the final truth)', () => {
    let inFlight: number
    let invalidate: ReturnType<typeof vi.spyOn>
    beforeEach(() => {
      inFlight = 0
      h = settingsMutationHandlers(client, () => inFlight)
      // 模拟重新拉取：主进程仍是初始值
      invalidate = vi.spyOn(client, 'invalidateQueries').mockImplementation(async () => {
        client.setQueryData(queryKeys.settings, base)
      })
    })

    it('two writes of the same key fail in turn → ends at the server value', () => {
      const p1 = { 'appearance.theme': 'washi' } as never
      const p2 = { 'appearance.theme': 'matsuba' } as never
      const c1 = h.onMutate(p1)
      const c2 = h.onMutate(p2)
      inFlight = 1 // 第 1 次失败时第 2 次仍在途
      h.onError(err, p1, c1)
      expect(invalidate).not.toHaveBeenCalled()
      inFlight = 0
      h.onError(err, p2, c2)
      expect(invalidate).toHaveBeenCalledTimes(1)
      expect(cache()['appearance.theme']).toBe('default')
    })

    it('same-value ABA: the first of two identical writes fails while the second is in flight', () => {
      const p = { 'appearance.theme': 'washi' } as never
      const c1 = h.onMutate(p)
      h.onMutate(p)
      inFlight = 1
      h.onError(err, p, c1)
      expect(invalidate).not.toHaveBeenCalled()
      inFlight = 0
      // 第 2 次若失败：重新拉取回到服务器值
      h.onError(err, p, h.onMutate(p))
      expect(cache()['appearance.theme']).toBe('default')
    })

    it('a single failure refetches too', () => {
      const p = { 'appearance.theme': 'washi' } as never
      h.onError(err, p, h.onMutate(p))
      expect(invalidate).toHaveBeenCalledTimes(1)
    })
  })

  it('does nothing while the cache is not loaded', () => {
    const empty = new QueryClient()
    const eh = settingsMutationHandlers(empty)
    const ctx = eh.onMutate({ 'appearance.theme': 'washi' } as never)
    expect(ctx).toEqual({ previous: {}, optimistic: {} })
    eh.onError(err, {} as never, ctx)
    expect(empty.getQueryData(queryKeys.settings)).toBeUndefined()
  })
})
