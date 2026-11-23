import { QueryClient } from '@tanstack/react-query'
import { beforeEach, describe, expect, it } from 'vitest'
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

  it('compares object values (associations) by content', () => {
    const p1 = { 'preview.associations': { txt: 'a' } } as never
    const c1 = h.onMutate(p1)
    h.onError(err, p1, c1)
    expect(cache()['preview.associations']).toEqual({})
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
