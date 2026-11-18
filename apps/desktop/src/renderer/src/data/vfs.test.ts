import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryObserver, focusManager } from '@tanstack/react-query'
import { AppError, VFS_REFRESH_MAX, type DirectoryListing, type FileEntry } from '@pch/shared'
import {
  createInterestSender,
  directoryQuery,
  directoryState,
  listDirectory,
  refreshDirectories,
  retryDirectory,
  type Invoke
} from './vfs'

const EMPTY = { focus: null, visible: [], offscreen: [] }

describe('createInterestSender', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('300ms 防抖：连续变化（滚动中）只在停止后发送最后一次', () => {
    const send = vi.fn()
    const s = createInterestSender(send)
    s.set({ focus: 'file:///a', visible: ['file:///a'], offscreen: [] })
    vi.advanceTimersByTime(200)
    s.set({ focus: 'file:///a', visible: ['file:///b'], offscreen: ['file:///a'] })
    vi.advanceTimersByTime(299)
    expect(send).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith({
      focus: 'file:///a',
      visible: ['file:///b'],
      offscreen: ['file:///a']
    })
  })

  it('内容相同的关注点不重复发送', () => {
    const send = vi.fn()
    const s = createInterestSender(send)
    s.set({ focus: 'file:///a', visible: [], offscreen: [] })
    vi.advanceTimersByTime(300)
    s.set({ focus: 'file:///a', visible: [], offscreen: [] })
    vi.advanceTimersByTime(300)
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('dispose 取消待发送的防抖并立即发送空关注点', () => {
    const send = vi.fn()
    const s = createInterestSender(send)
    s.set({ focus: 'file:///a', visible: [], offscreen: [] })
    s.dispose()
    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith(EMPTY)
    vi.advanceTimersByTime(1000)
    expect(send).toHaveBeenCalledTimes(1)
  })
})

describe('directoryState', () => {
  const items: FileEntry[] = []

  it('首次获取中为 loading；成功后为 ready，并带上扫描进程给出的 state / checkedAt', () => {
    expect(directoryState({ data: undefined, isError: false, error: null })).toEqual({
      status: 'loading'
    })
    const data: DirectoryListing = { items, state: 'cached', checkedAt: 123 }
    expect(directoryState({ data, isError: false, error: null })).toEqual({
      status: 'ready',
      items,
      state: 'cached',
      checkedAt: 123
    })
  })

  it('获取失败时为 error，并取出错误码', () => {
    const error = new AppError({ code: 'FS_NOT_FOUND' })
    expect(directoryState({ data: undefined, isError: true, error })).toEqual({
      status: 'error',
      code: 'FS_NOT_FOUND'
    })
    expect(directoryState({ data: undefined, isError: true, error: new Error('x') })).toEqual({
      status: 'error',
      code: 'UNKNOWN'
    })
  })

  it('已列出过的目录重新获取失败（展开中被删除）时显示错误，而不是沿用旧列表', () => {
    // TanStack Query 在重新获取失败时保留上一次的 data
    const error = new AppError({ code: 'FS_NOT_FOUND' })
    const data: DirectoryListing = { items, state: 'fresh', checkedAt: 1 }
    expect(directoryState({ data, isError: true, error })).toEqual({
      status: 'error',
      code: 'FS_NOT_FOUND'
    })
  })
})

type Deferred = { resolve: (v: DirectoryListing) => void; reject: (e: unknown) => void }

/** 可控的 IPC 假实现：记录调用顺序，vfs.list 的结果由测试逐个兑现 */
function fakeInvoke(): { invoke: Invoke; calls: string[]; inputs: unknown[]; lists: Deferred[] } {
  const calls: string[] = []
  const inputs: unknown[] = []
  const lists: Deferred[] = []
  const invoke = ((channel: string, input: { requestId?: string; uri?: string }) => {
    calls.push(`${channel} ${input.requestId ?? ''}`.trimEnd())
    inputs.push(input)
    if (channel === 'vfs.list') {
      return new Promise<DirectoryListing>((resolve, reject) => lists.push({ resolve, reject }))
    }
    return Promise.resolve(undefined)
  }) as Invoke
  return { invoke, calls, inputs, lists }
}

const cancelled = (): AppError => new AppError({ code: 'FS_CANCELLED' })
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0))
const listing = (uri: string, ...names: string[]): DirectoryListing => ({
  items: names.map((name) => ({
    uri: `${uri}/${name}`,
    name,
    kind: 'file',
    size: 0,
    mtime: 0,
    hidden: false
  })),
  state: 'fresh',
  checkedAt: 1
})

describe('listDirectory', () => {
  const uri = 'file:///C:/share'

  it('signal 中止时以同一 requestId 通知主进程取消（降级模式的直接枚举）', async () => {
    const { invoke, calls } = fakeInvoke()
    const controller = new AbortController()
    void listDirectory(uri, controller.signal, invoke).catch(() => undefined)
    controller.abort()
    expect(calls).toEqual([`vfs.list dir:${uri}`, `vfs.cancel dir:${uri}`])
  })

  it('请求结束后的中止不再发送取消（不会误取消之后同一 requestId 的新请求）', async () => {
    const { invoke, calls, lists } = fakeInvoke()
    const controller = new AbortController()
    const p = listDirectory(uri, controller.signal, invoke)
    lists[0]!.resolve(listing(uri))
    await p
    controller.abort()
    expect(calls).toEqual([`vfs.list dir:${uri}`])
  })
})

/** 与 createQueryClient 相同的全局默认 */
const appClient = (): QueryClient =>
  new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnWindowFocus: false } }
  })

describe('directoryQuery（TanStack Query 的取消接线）', () => {
  const uri = 'file:///C:/share'
  let client: QueryClient
  beforeEach(() => {
    client = appClient()
  })
  afterEach(() => client.clear())

  it('最后一个观察者离开（折叠 / 切换工作区）时取消进行中的列表，且不显示为错误', async () => {
    const { invoke, calls, lists } = fakeInvoke()
    const observer = new QueryObserver(client, directoryQuery(uri, invoke))
    const off = observer.subscribe(() => undefined)
    await flush()
    expect(calls).toEqual([`vfs.list dir:${uri}`])
    off()
    expect(calls).toEqual([`vfs.list dir:${uri}`, `vfs.cancel dir:${uri}`])
    // 主进程随后以 FS_CANCELLED 结束该请求：被忽略
    lists[0]!.reject(cancelled())
    await flush()
    const state = client.getQueryState(directoryQuery(uri, invoke).queryKey)
    expect(state?.status).not.toBe('error')
    expect(state?.fetchStatus).toBe('idle')
  })

  it('重新获取取代进行中的请求时，取消先于新请求发出；旧请求的 FS_CANCELLED 被忽略', async () => {
    const { invoke, calls, lists } = fakeInvoke()
    const observer = new QueryObserver(client, directoryQuery(uri, invoke))
    const results: string[] = []
    const off = observer.subscribe((r) => {
      if (r.status === 'error') results.push('error')
      if (r.data) results.push(r.data.items.map((e) => e.name).join(','))
    })
    await flush()
    lists[0]!.resolve(listing(uri, 'a'))
    await flush()
    // 有数据时的重新获取（vfs.changed / F5）：旧请求还在进行中
    void observer.refetch()
    await flush()
    void client.invalidateQueries({ queryKey: directoryQuery(uri, invoke).queryKey })
    await flush()
    expect(calls).toEqual([
      `vfs.list dir:${uri}`,
      `vfs.list dir:${uri}`,
      `vfs.cancel dir:${uri}`,
      `vfs.list dir:${uri}`
    ])
    lists[1]!.reject(cancelled())
    lists[2]!.resolve(listing(uri, 'a', 'b'))
    await flush()
    expect(results).not.toContain('error')
    expect(observer.getCurrentResult().data?.items.map((e) => e.name)).toEqual(['a', 'b'])
    off()
  })
})

describe('directoryQuery（不按时间重新获取，只在失效后重新获取）', () => {
  const uri = 'file:///C:/share'
  afterEach(() => vi.useRealTimers())

  it('时间经过、窗口重新获得焦点、再次挂载都不重新列出；没有轮询', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const client = appClient()
    client.mount()
    const { invoke, calls, lists } = fakeInvoke()
    const mountOnce = async (): Promise<() => void> => {
      const off = new QueryObserver(client, directoryQuery(uri, invoke)).subscribe(() => undefined)
      await flush()
      return off
    }
    try {
      const first = await mountOnce()
      lists[0]!.resolve(listing(uri))
      await flush()
      first()
      vi.setSystemTime(Date.now() + 60 * 60_000)
      const off = await mountOnce()
      focusManager.setFocused(false)
      focusManager.setFocused(true)
      await flush()
      expect(calls).toHaveLength(1)
      expect(directoryQuery(uri, invoke)).toMatchObject({
        staleTime: Infinity,
        refetchOnWindowFocus: false
      })
      expect(directoryQuery(uri, invoke)).not.toHaveProperty('refetchInterval')
      off()
    } finally {
      focusManager.setFocused(undefined)
      client.unmount()
      client.clear()
    }
  })

  it('折叠期间被标记为失效（vfs.changed）的目录，再次展开时重新列出', async () => {
    const client = appClient()
    const { invoke, calls, lists } = fakeInvoke()
    try {
      const off = new QueryObserver(client, directoryQuery(uri, invoke)).subscribe(() => undefined)
      await flush()
      lists[0]!.resolve(listing(uri))
      await flush()
      off()
      // 非活动查询：只标记失效，不立即重新获取
      await client.invalidateQueries({ queryKey: directoryQuery(uri, invoke).queryKey })
      expect(calls).toHaveLength(1)
      const again = new QueryObserver(client, directoryQuery(uri, invoke)).subscribe(
        () => undefined
      )
      await flush()
      expect(calls).toHaveLength(2)
      again()
    } finally {
      client.clear()
    }
  })
})

describe('refreshDirectories / retryDirectory', () => {
  let client: QueryClient
  beforeEach(() => {
    client = appClient()
  })
  afterEach(() => client.clear())

  /** 挂载一组目录查询（相当于树中已展开的目录），首次列出都已完成 */
  const mount = async (uris: string[], f: ReturnType<typeof fakeInvoke>): Promise<() => void> => {
    const offs = uris.map((uri) =>
      new QueryObserver(client, directoryQuery(uri, f.invoke)).subscribe(() => undefined)
    )
    await flush()
    f.lists.splice(0).forEach((d, i) => d.resolve(listing(uris[i]!)))
    await flush()
    return () => offs.forEach((off) => off())
  }

  it('F5 / 刷新按钮：对所有正在显示的目录发送 vfs.refresh，再让它们重新列出', async () => {
    const f = fakeInvoke()
    const off = await mount(['file:///C:/a', 'file:///C:/b'], f)
    // 已折叠（非活动）的目录不在 refresh 中
    const inactive = await mount(['file:///C:/collapsed'], f)
    inactive()
    f.calls.length = 0
    f.inputs.length = 0

    await refreshDirectories(client, f.invoke)
    await flush()
    expect(f.calls[0]).toBe('vfs.refresh')
    expect(f.inputs[0]).toEqual({ uris: ['file:///C:/a', 'file:///C:/b'] })
    expect(f.calls.slice(1).sort()).toEqual([
      'vfs.list dir:file:///C:/a',
      'vfs.list dir:file:///C:/b'
    ])
    off()
  })

  it('目录数超过 vfs.refresh 的上限时分批发送', async () => {
    const f = fakeInvoke()
    const uris = Array.from({ length: VFS_REFRESH_MAX + 1 }, (_, i) => `file:///C:/d${i}`)
    const off = await mount(uris, f)
    f.calls.length = 0
    f.inputs.length = 0
    await refreshDirectories(client, f.invoke)
    const batches = f.inputs.filter((_, i) => f.calls[i] === 'vfs.refresh') as {
      uris: string[]
    }[]
    expect(batches.map((b) => b.uris.length)).toEqual([VFS_REFRESH_MAX, 1])
    off()
  })

  it('「重试」：对该目录发送 vfs.refresh，再让该查询重新获取', async () => {
    const f = fakeInvoke()
    const off = await mount(['file:///C:/a', 'file:///C:/b'], f)
    f.calls.length = 0
    f.inputs.length = 0
    await retryDirectory(client, 'file:///C:/a', f.invoke)
    await flush()
    expect(f.calls).toEqual(['vfs.refresh', 'vfs.list dir:file:///C:/a'])
    expect(f.inputs[0]).toEqual({ uris: ['file:///C:/a'] })
    off()
  })
})
