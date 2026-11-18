import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createWatchScheduler, isNetworkUri } from './vfs'

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
