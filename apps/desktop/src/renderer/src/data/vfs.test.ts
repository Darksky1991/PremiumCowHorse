import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryObserver, focusManager } from '@tanstack/react-query'
import { AppError, type FileEntry } from '@pch/shared'
import {
  DIRECTORY_STALE_MS,
  createWatchScheduler,
  directoryQuery,
  directoryState,
  isNetworkUri,
  listDirectory,
  watchableUris,
  type DirectoryState,
  type Invoke
} from './vfs'

describe('isNetworkUri', () => {
  it('带主机名的 file URI（UNC）是网络路径', () => {
    expect(isNetworkUri('file://server/share')).toBe(true)
  })

  it('本地 file URI 不是网络路径', () => {
    expect(isNetworkUri('file:///C:/x')).toBe(false)
  })

  it('非 file scheme 与非法 URI 不是网络路径', () => {
    expect(isNetworkUri('sftp://host/x')).toBe(false)
    expect(isNetworkUri('not a uri')).toBe(false)
  })
})

describe('createWatchScheduler', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('集合变化经 200ms 防抖后只发送最后一次集合', () => {
    const send = vi.fn()
    const s = createWatchScheduler(send)
    s.set(['file:///a'])
    s.set(['file:///a', 'file:///b'])
    vi.advanceTimersByTime(199)
    expect(send).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith(['file:///a', 'file:///b'])
  })

  it('收到属于当前集合的 vfs.changed 时，防抖后重发完整集合（重建失效的监听）', () => {
    const send = vi.fn()
    const s = createWatchScheduler(send)
    s.set(['file:///a', 'file:///b'])
    vi.advanceTimersByTime(200)
    send.mockClear()

    s.notifyChanged('file:///a')
    s.notifyChanged('file:///a')
    vi.advanceTimersByTime(200)
    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith(['file:///a', 'file:///b'])
  })

  it('不属于当前集合的 vfs.changed 被忽略', () => {
    const send = vi.fn()
    const s = createWatchScheduler(send)
    s.set(['file:///a'])
    vi.advanceTimersByTime(200)
    send.mockClear()

    s.notifyChanged('file:///other')
    vi.advanceTimersByTime(1000)
    expect(send).not.toHaveBeenCalled()
  })

  it('dispose 取消待发送的防抖并立即发送空集合', () => {
    const send = vi.fn()
    const s = createWatchScheduler(send)
    s.set(['file:///a'])
    s.dispose()
    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith([])
    vi.advanceTimersByTime(1000)
    expect(send).toHaveBeenCalledTimes(1)
  })
})

describe('directoryState', () => {
  const items: FileEntry[] = []

  it('首次获取中为 loading，成功后为 ready', () => {
    expect(directoryState({ data: undefined, isError: false, error: null })).toEqual({
      status: 'loading'
    })
    expect(directoryState({ data: items, isError: false, error: null })).toEqual({
      status: 'ready',
      items
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
    expect(directoryState({ data: items, isError: true, error })).toEqual({
      status: 'error',
      code: 'FS_NOT_FOUND'
    })
  })
})

describe('watchableUris', () => {
  const ready: DirectoryState = { status: 'ready', items: [] }

  it('只监听列表已就绪的目录，保持原顺序', () => {
    const directories = new Map<string, DirectoryState>([
      ['file:///C:/a', ready],
      ['file:///C:/b', { status: 'loading' }],
      ['file:///C:/c', { status: 'error', code: 'FS_NOT_FOUND' }],
      ['file:///C:/d', ready]
    ])
    expect(
      watchableUris(['file:///C:/d', 'file:///C:/a', 'file:///C:/b', 'file:///C:/c'], directories)
    ).toEqual(['file:///C:/d', 'file:///C:/a'])
  })

  it('还没有状态的目录不监听', () => {
    expect(watchableUris(['file:///C:/x'], new Map())).toEqual([])
  })

  it('出错的目录恢复为就绪后重新进入监听集合（删除后重建 → 重试）', () => {
    const uri = 'file:///C:/x'
    const failed = new Map<string, DirectoryState>([
      [uri, { status: 'error', code: 'FS_NOT_FOUND' }]
    ])
    const recovered = new Map<string, DirectoryState>([[uri, ready]])
    expect(watchableUris([uri], failed)).toEqual([])
    expect(watchableUris([uri], recovered)).toEqual([uri])
  })
})

/** 可控的 IPC 假实现：记录调用顺序，vfs.list 的结果由测试逐个兑现 */
function fakeInvoke(): {
  invoke: Invoke
  calls: string[]
  lists: { resolve: (v: FileEntry[]) => void; reject: (e: unknown) => void }[]
} {
  const calls: string[] = []
  const lists: { resolve: (v: FileEntry[]) => void; reject: (e: unknown) => void }[] = []
  const invoke = ((channel: string, input: { requestId?: string }) => {
    calls.push(`${channel} ${input.requestId ?? ''}`)
    if (channel === 'vfs.list') {
      return new Promise<FileEntry[]>((resolve, reject) => lists.push({ resolve, reject }))
    }
    return Promise.resolve(undefined)
  }) as Invoke
  return { invoke, calls, lists }
}

const cancelled = (): AppError => new AppError({ code: 'FS_CANCELLED' })
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

describe('listDirectory', () => {
  const uri = 'file:///C:/share'

  it('signal 中止时以同一 requestId 通知主进程取消', async () => {
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
    lists[0]!.resolve([])
    await p
    controller.abort()
    expect(calls).toEqual([`vfs.list dir:${uri}`])
  })
})

describe('directoryQuery（TanStack Query 的取消接线）', () => {
  const uri = 'file:///C:/share'
  const entry = (name: string): FileEntry => ({
    uri: `${uri}/${name}`,
    name,
    kind: 'file',
    size: 0,
    mtime: 0,
    hidden: false
  })
  let client: QueryClient
  beforeEach(() => {
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  })
  afterEach(() => client.clear())

  it('最后一个观察者离开（折叠 / 切换工作区）时取消进行中的列表，且不显示为错误', async () => {
    const { invoke, calls, lists } = fakeInvoke()
    const observer = new QueryObserver(client, directoryQuery(uri, 0, invoke))
    const off = observer.subscribe(() => undefined)
    await flush()
    expect(calls).toEqual([`vfs.list dir:${uri}`])
    off()
    expect(calls).toEqual([`vfs.list dir:${uri}`, `vfs.cancel dir:${uri}`])
    // 主进程随后以 FS_CANCELLED 结束该请求：被忽略
    lists[0]!.reject(cancelled())
    await flush()
    const state = client.getQueryState(directoryQuery(uri, 0, invoke).queryKey)
    expect(state?.status).not.toBe('error')
    expect(state?.fetchStatus).toBe('idle')
  })

  it('重新获取取代进行中的请求时，取消先于新请求发出；旧请求的 FS_CANCELLED 被忽略', async () => {
    const { invoke, calls, lists } = fakeInvoke()
    const observer = new QueryObserver(client, directoryQuery(uri, 0, invoke))
    const results: string[] = []
    const off = observer.subscribe((r) => {
      if (r.status === 'error') results.push('error')
      if (r.data) results.push(r.data.map((e) => e.name).join(','))
    })
    await flush()
    lists[0]!.resolve([entry('a')])
    await flush()
    // 有数据时的重新获取（vfs.changed / F5）：旧请求还在进行中
    void observer.refetch()
    await flush()
    void client.invalidateQueries({ queryKey: directoryQuery(uri, 0, invoke).queryKey })
    await flush()
    expect(calls).toEqual([
      `vfs.list dir:${uri}`,
      `vfs.list dir:${uri}`,
      `vfs.cancel dir:${uri}`,
      `vfs.list dir:${uri}`
    ])
    lists[1]!.reject(cancelled())
    lists[2]!.resolve([entry('a'), entry('b')])
    await flush()
    expect(results).not.toContain('error')
    expect(observer.getCurrentResult().data?.map((e) => e.name)).toEqual(['a', 'b'])
    off()
  })
})

describe('directoryQuery（新鲜期与重新列出）', () => {
  const uri = 'file:///C:/share'
  afterEach(() => vi.useRealTimers())

  it('全局 staleTime 为 Infinity 时，目录超过新鲜期后重新挂载（再次展开 / 切回工作区）与聚焦会重新列出', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    // 与 createQueryClient 相同的全局默认
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false, staleTime: Infinity, refetchOnWindowFocus: false }
      }
    })
    client.mount()
    const { invoke, calls, lists } = fakeInvoke()
    const mountOnce = async (): Promise<() => void> => {
      const off = new QueryObserver(client, directoryQuery(uri, 0, invoke)).subscribe(
        () => undefined
      )
      await flush()
      return off
    }
    try {
      const first = await mountOnce()
      lists[0]!.resolve([])
      await flush()
      first()
      // 新鲜期内折叠后再展开：沿用缓存，不重新列出
      vi.setSystemTime(Date.now() + DIRECTORY_STALE_MS - 1)
      ;(await mountOnce())()
      expect(calls).toHaveLength(1)
      // 超过新鲜期：重新挂载即重新列出（被折叠的目录不在监听中，期间的变化只能这样发现）
      vi.setSystemTime(Date.now() + 2)
      const off = await mountOnce()
      expect(calls).toHaveLength(2)
      lists[1]!.resolve([])
      await flush()
      // 挂载中的目录：超过新鲜期后窗口重新获得焦点也重新列出
      vi.setSystemTime(Date.now() + DIRECTORY_STALE_MS + 1)
      focusManager.onFocus()
      await flush()
      expect(calls).toHaveLength(3)
      off()
    } finally {
      client.unmount()
      client.clear()
    }
  })
})
