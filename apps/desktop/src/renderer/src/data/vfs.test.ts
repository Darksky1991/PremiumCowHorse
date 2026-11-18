import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppError, type FileEntry } from '@pch/shared'
import {
  createWatchScheduler,
  directoryState,
  isNetworkUri,
  watchableUris,
  type DirectoryState
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
