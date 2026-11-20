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

  it('vfs.changed 让该目录自身与其直接子项的 stat 失效（预览标签的文件信息）', () => {
    const self = queryKeys.stat('file:///C:/a')
    const child = queryKeys.stat('file:///C:/a/x.txt')
    const grandchild = queryKeys.stat('file:///C:/a/b/y.txt')
    const sibling = queryKeys.stat('file:///C:/ab/x.txt')
    const inRoot = queryKeys.stat('file:///C:/z.txt')
    for (const key of [self, child, grandchild, sibling, inRoot]) client.setQueryData(key, {})
    emit('vfs.changed', { uri: 'file:///C:/a' })
    expect(client.getQueryState(self)?.isInvalidated).toBe(true)
    expect(client.getQueryState(child)?.isInvalidated).toBe(true)
    expect(client.getQueryState(grandchild)?.isInvalidated).toBe(false)
    expect(client.getQueryState(sibling)?.isInvalidated).toBe(false)
    // 驱动器根的 URI 以 / 结尾（normalizeRootUri）
    emit('vfs.changed', { uri: 'file:///C:/' })
    expect(client.getQueryState(inRoot)?.isInvalidated).toBe(true)
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

  it('共享恢复在线（online）时，让该共享 / 卷下的目录查询失效；offline 不失效', () => {
    const onShare = queryKeys.directory('file://Srv/Share/a')
    const shareRoot = queryKeys.directory('file://srv/share')
    const otherShare = queryKeys.directory('file://srv/other/a')
    const local = queryKeys.directory('file:///E:/x')
    for (const k of [onShare, shareRoot, otherShare, local]) {
      client.setQueryData(k, { items: [], state: 'offline', checkedAt: 1 })
    }
    emit('vfs.reachability', { share: '\\\\srv\\share', state: 'offline', since: 1 })
    expect(client.getQueryState(onShare)?.isInvalidated).toBe(false)
    emit('vfs.reachability', { share: '\\\\srv\\share', state: 'online', since: 2 })
    expect(client.getQueryState(onShare)?.isInvalidated).toBe(true)
    expect(client.getQueryState(shareRoot)?.isInvalidated).toBe(true)
    expect(client.getQueryState(otherShare)?.isInvalidated).toBe(false)
    expect(client.getQueryState(local)?.isInvalidated).toBe(false)
    emit('vfs.reachability', { share: 'E:', state: 'online', since: 3 })
    expect(client.getQueryState(local)?.isInvalidated).toBe(true)
  })

  it('全局默认：永不过期、聚焦时不重新获取、不重试', () => {
    expect(client.getDefaultOptions().queries).toMatchObject({
      staleTime: Infinity,
      refetchOnWindowFocus: false,
      retry: false
    })
  })
})
