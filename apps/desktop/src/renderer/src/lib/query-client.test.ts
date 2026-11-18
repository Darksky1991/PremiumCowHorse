import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { QueryClient } from '@tanstack/react-query'
import type { PchBridge } from '@pch/shared'
import { bridgeMainEvents, createQueryClient } from './query-client'
import { queryKeys } from './query-keys'

/** 假的 window.pch：on() 登记的监听器由测试直接触发 */
function stubBridge(): { emit: (event: string, payload: unknown) => void } {
  const listeners = new Map<string, Set<(p: unknown) => void>>()
  const bridge: PchBridge = {
    invoke: async () => ({ ok: true, data: undefined }),
    on: (event, listener) => {
      const set = listeners.get(event) ?? new Set()
      set.add(listener)
      listeners.set(event, set)
      return () => set.delete(listener)
    },
    getPathForFile: () => '',
    bootstrap: null
  }
  vi.stubGlobal('window', { pch: bridge })
  return { emit: (event, payload) => listeners.get(event)?.forEach((l) => l(payload)) }
}

describe('bridgeMainEvents', () => {
  let client: QueryClient
  let off: () => void
  let emit: (event: string, payload: unknown) => void
  beforeEach(() => {
    emit = stubBridge().emit
    client = createQueryClient()
    off = bridgeMainEvents(client)
  })
  afterEach(() => {
    off()
    client.clear()
    vi.unstubAllGlobals()
  })

  it('vfs.changed 只让该目录的查询失效', () => {
    const a = queryKeys.directory('file:///C:/a')
    const b = queryKeys.directory('file:///C:/b')
    client.setQueryData(a, { items: [], state: 'fresh', checkedAt: 1 })
    client.setQueryData(b, { items: [], state: 'fresh', checkedAt: 1 })
    emit('vfs.changed', { uri: 'file:///C:/a' })
    expect(client.getQueryState(a)?.isInvalidated).toBe(true)
    expect(client.getQueryState(b)?.isInvalidated).toBe(false)
  })

  it('workspace.changed 使该工作区的条目与索引目标失效', () => {
    const entries = queryKeys.entries('w1')
    const index = queryKeys.indexTargets('w1')
    const other = queryKeys.indexTargets('w2')
    client.setQueryData(entries, [])
    client.setQueryData(index, [])
    client.setQueryData(other, [])
    emit('workspace.changed', { id: 'w1' })
    expect(client.getQueryState(entries)?.isInvalidated).toBe(true)
    expect(client.getQueryState(index)?.isInvalidated).toBe(true)
    expect(client.getQueryState(other)?.isInvalidated).toBe(false)
  })

  it('全局默认：永不过期、聚焦时不重新获取、不重试', () => {
    expect(client.getDefaultOptions().queries).toMatchObject({
      staleTime: Infinity,
      refetchOnWindowFocus: false,
      retry: false
    })
  })
})
