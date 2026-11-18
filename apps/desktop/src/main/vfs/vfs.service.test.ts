import { EventEmitter } from 'node:events'
import fsSync, { mkdtempSync, rmSync, type FSWatcher } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FileEntry, FileStat } from '@pch/shared'
import { LocalProvider } from './providers/local.provider'
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
  readonly invalidators = new Map<string, () => void>()
  watch(uri: URL, onChange: () => void, onClose?: () => void): { close(): void } {
    this.watched.push(uri.href)
    this.triggers.set(uri.href, onChange)
    if (onClose) this.invalidators.set(uri.href, onClose)
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

  it('removes a self-invalidated watch, still notifies once, and recreates it on the next setWatched', () => {
    vi.useFakeTimers()
    const p = new WatchProvider()
    const onDirectoryChanged = vi.fn()
    const vfs = new VfsService([p], { onDirectoryChanged })
    vfs.setWatched(1, [A])
    const href = new URL(A).href
    // provider 先通知变化再报告失效
    p.triggers.get(href)!()
    p.invalidators.get(href)!()
    vi.advanceTimersByTime(300)
    expect(onDirectoryChanged).toHaveBeenCalledTimes(1)
    expect(onDirectoryChanged).toHaveBeenCalledWith(A)
    // 退避期内不重建；退避结束后的下一次 setWatched 重建
    vfs.setWatched(1, [A])
    expect(p.watched).toEqual([href])
    vi.advanceTimersByTime(60_000)
    vfs.setWatched(1, [A])
    expect(p.watched).toEqual([href, href])
  })

  it('does not keep an entry when the provider fails synchronously during watch', () => {
    class FailingProvider extends WatchProvider {
      override watch(uri: URL, _onChange: () => void, onClose?: () => void): { close(): void } {
        this.watched.push(uri.href)
        onClose?.()
        return { close: () => undefined }
      }
    }
    vi.useFakeTimers()
    const p = new FailingProvider()
    const vfs = new VfsService([p])
    vfs.setWatched(1, [A])
    vi.advanceTimersByTime(60_000)
    vfs.setWatched(1, [A])
    expect(p.watched).toHaveLength(2)
  })

  it('backs off re-watching a URI that invalidated itself while it stays in the set', () => {
    vi.useFakeTimers()
    const p = new WatchProvider()
    const vfs = new VfsService([p], { watchRetryBackoffMs: 1000 })
    const href = new URL(A).href
    vfs.setWatched(1, [A, B])
    p.invalidators.get(href)!()
    // 集合不变（例如渲染端因其他目录的变化重发）：退避期内不重建 A，B 不受影响
    vfs.setWatched(1, [A, B])
    vi.advanceTimersByTime(999)
    vfs.setWatched(1, [A, B])
    expect(p.watched).toEqual([href, new URL(B).href])
    vi.advanceTimersByTime(1)
    vfs.setWatched(1, [A, B])
    expect(p.watched).toEqual([href, new URL(B).href, href])
  })

  it('backs off per URI for every owner sharing it', () => {
    vi.useFakeTimers()
    const p = new WatchProvider()
    const vfs = new VfsService([p], { watchRetryBackoffMs: 1000 })
    vfs.setWatched(1, [A])
    vfs.setWatched(2, [A])
    p.invalidators.get(new URL(A).href)!()
    vfs.setWatched(2, [A])
    expect(p.watched).toHaveLength(1)
  })

  it('a watch rebuilt after the backoff is shared with owners that kept wanting it', () => {
    vi.useFakeTimers()
    const p = new WatchProvider()
    const vfs = new VfsService([p], { watchRetryBackoffMs: 1000 })
    vfs.setWatched(1, [A])
    vfs.setWatched(2, [A])
    p.invalidators.get(new URL(A).href)!()
    vi.advanceTimersByTime(1000)
    vfs.setWatched(2, [A])
    expect(p.watched).toHaveLength(2)
    // owner 2 释放后 owner 1 仍需要：不关闭
    vfs.releaseOwner(2)
    expect(p.closed).toHaveLength(0)
    vfs.releaseOwner(1)
    expect(p.closed).toHaveLength(1)
  })

  it('rebuilds immediately once the URI has left every set (deleted, re-created and retried)', () => {
    vi.useFakeTimers()
    const p = new WatchProvider()
    const vfs = new VfsService([p], { watchRetryBackoffMs: 60_000 })
    const href = new URL(A).href
    vfs.setWatched(1, [A])
    vfs.setWatched(2, [A])
    p.invalidators.get(href)!()
    // 列表出错后渲染端把它移出集合；仍有其他 owner 期望它时退避保留
    vfs.setWatched(1, [])
    vfs.setWatched(1, [A])
    expect(p.watched).toEqual([href])
    vfs.setWatched(1, [])
    vfs.releaseOwner(2)
    // 「重试」使列表恢复后重新加入集合：立即重建
    vfs.setWatched(1, [A])
    expect(p.watched).toEqual([href, href])
  })

  it('dispose drops the backoff records', async () => {
    vi.useFakeTimers()
    const p = new WatchProvider()
    const vfs = new VfsService([p], { watchRetryBackoffMs: 60_000 })
    vfs.setWatched(1, [A])
    p.invalidators.get(new URL(A).href)!()
    await vfs.dispose()
    vfs.setWatched(1, [A])
    expect(p.watched).toHaveLength(2)
  })
})

describe('VfsService with LocalProvider: watcher errors on a directory that still exists', () => {
  let root: string
  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'pch-vfs-'))
  })
  afterEach(() => {
    vi.restoreAllMocks()
    rmSync(root, { recursive: true, force: true })
  })

  it('does not notify a change and does not re-create the watch during the backoff', async () => {
    const fakes: (EventEmitter & { close: () => void })[] = []
    vi.spyOn(fsSync, 'watch').mockImplementation(() => {
      const fake = Object.assign(new EventEmitter(), { close: () => undefined })
      fakes.push(fake)
      return fake as unknown as FSWatcher
    })
    const onDirectoryChanged = vi.fn()
    const vfs = new VfsService([new LocalProvider()], {
      onDirectoryChanged,
      watchDebounceMs: 10,
      watchRetryBackoffMs: 60_000
    })
    const uri = pathToFileURL(root).href
    vfs.setWatched(1, [uri])
    expect(fakes).toHaveLength(1)
    fakes[0]!.emit('error', Object.assign(new Error('not supported'), { code: 'EPERM' }))
    // 等 provider 确认目录仍在（fs.stat）并超过防抖时间
    await new Promise((r) => setTimeout(r, 200))
    expect(onDirectoryChanged).not.toHaveBeenCalled()
    vfs.setWatched(1, [uri])
    expect(fakes).toHaveLength(1)
    await vfs.dispose()
  })
})
