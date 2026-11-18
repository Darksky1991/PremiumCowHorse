import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FileEntry, FileStat } from '@pch/shared'
import type { FileSystemProvider } from './types'
import { VfsService } from './vfs.service'

/** list 永不完成（也不响应 signal），模拟无响应的网络共享 */
class HangingProvider implements FileSystemProvider {
  readonly scheme = 'file' as const
  stat(): Promise<FileStat> {
    return new Promise(() => undefined)
  }
  list(): Promise<FileEntry[]> {
    return new Promise(() => undefined)
  }
  async dispose(): Promise<void> {
    // 无资源
  }
}

describe('VfsService', () => {
  it('rejects an unparsable URI with FS_INVALID_URI', async () => {
    const vfs = new VfsService([new HangingProvider()])
    await expect(vfs.list('not a uri')).rejects.toMatchObject({ code: 'FS_INVALID_URI' })
  })

  it('rejects a scheme without a provider with FS_UNSUPPORTED_SCHEME', async () => {
    const vfs = new VfsService([new HangingProvider()])
    await expect(vfs.stat('ftp://x/y')).rejects.toMatchObject({ code: 'FS_UNSUPPORTED_SCHEME' })
  })

  it('cancels an in-flight request by id even if the provider ignores the signal', async () => {
    const vfs = new VfsService([new HangingProvider()])
    const pending = vfs.list('file:///C:/share', 'req-1')
    expect(vfs.pending).toBe(1)
    vfs.cancel('req-1')
    await expect(pending).rejects.toMatchObject({ code: 'FS_CANCELLED' })
    expect(vfs.pending).toBe(0)
  })

  it('times out a request that never completes', async () => {
    const vfs = new VfsService([new HangingProvider()], { timeoutMs: 50 })
    await expect(vfs.list('file:///C:/share', 'req-2')).rejects.toMatchObject({
      code: 'FS_TIMEOUT'
    })
    expect(vfs.pending).toBe(0)
  })

  it('a new request with the same id supersedes (cancels) the previous one', async () => {
    const vfs = new VfsService([new HangingProvider()], { timeoutMs: 1000 })
    const first = vfs.list('file:///C:/a', 'same')
    const second = vfs.list('file:///C:/b', 'same')
    await expect(first).rejects.toMatchObject({ code: 'FS_CANCELLED' })
    expect(vfs.pending).toBe(1)
    vfs.cancel('same')
    await expect(second).rejects.toMatchObject({ code: 'FS_CANCELLED' })
    expect(vfs.pending).toBe(0)
  })

  it('cancelling an unknown id is a no-op', () => {
    expect(() => new VfsService([]).cancel('nope')).not.toThrow()
  })
})

/** 记录 watch / close 调用的假 provider */
class WatchProvider extends HangingProvider {
  readonly watched: string[] = []
  readonly closed: string[] = []
  readonly triggers = new Map<string, () => void>()
  watch(uri: URL, onChange: () => void): { close(): void } {
    this.watched.push(uri.href)
    this.triggers.set(uri.href, onChange)
    return { close: () => void this.closed.push(uri.href) }
  }
}

describe('VfsService watching', () => {
  const A = 'file:///c:/a'
  const B = 'file:///c:/b'
  afterEach(() => vi.useRealTimers())

  it('shares one watch between owners and closes it after the last release', () => {
    const p = new WatchProvider()
    const vfs = new VfsService([p])
    vfs.setWatched(1, [A])
    vfs.setWatched(2, [A])
    expect(p.watched).toHaveLength(1)
    vfs.releaseOwner(1)
    expect(p.closed).toHaveLength(0)
    vfs.releaseOwner(2)
    expect(p.closed).toHaveLength(1)
  })

  it('replaces an owner watch set and closes the dropped URI', () => {
    const p = new WatchProvider()
    const vfs = new VfsService([p])
    vfs.setWatched(1, [A])
    vfs.setWatched(1, [B])
    expect(p.watched).toEqual([new URL(A).href, new URL(B).href])
    expect(p.closed).toEqual([new URL(A).href])
  })

  it('ignores unsupported schemes, invalid URIs and providers without watch', () => {
    const vfs = new VfsService([new HangingProvider()])
    expect(() => vfs.setWatched(1, ['ftp://x/y', 'not a uri', A])).not.toThrow()
  })

  it('debounces repeated changes into one callback', () => {
    vi.useFakeTimers()
    const p = new WatchProvider()
    const onDirectoryChanged = vi.fn()
    const vfs = new VfsService([p], { onDirectoryChanged })
    vfs.setWatched(1, [A])
    const trigger = p.triggers.get(new URL(A).href)!
    trigger()
    vi.advanceTimersByTime(100)
    trigger()
    vi.advanceTimersByTime(100)
    trigger()
    expect(onDirectoryChanged).not.toHaveBeenCalled()
    vi.advanceTimersByTime(300)
    expect(onDirectoryChanged).toHaveBeenCalledTimes(1)
    expect(onDirectoryChanged).toHaveBeenCalledWith(A)
  })

  it('dispose closes all watches and drops pending callbacks', async () => {
    vi.useFakeTimers()
    const p = new WatchProvider()
    const onDirectoryChanged = vi.fn()
    const vfs = new VfsService([p], { onDirectoryChanged })
    vfs.setWatched(1, [A])
    p.triggers.get(new URL(A).href)!()
    await vfs.dispose()
    vi.advanceTimersByTime(1000)
    expect(p.closed).toHaveLength(1)
    expect(onDirectoryChanged).not.toHaveBeenCalled()
  })
})
