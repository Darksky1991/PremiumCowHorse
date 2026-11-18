import { describe, expect, it } from 'vitest'
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

  it('takes the timeout per URI (vfs.timeoutSec by location) when given a function', async () => {
    const asked: string[] = []
    const vfs = new VfsService([new HangingProvider()], {
      timeoutMs: (uri) => {
        asked.push(uri)
        return uri.startsWith('file://srv/') ? 200 : 20
      }
    })
    const started = Date.now()
    await expect(vfs.list('file:///C:/a')).rejects.toMatchObject({ code: 'FS_TIMEOUT' })
    const local = Date.now() - started
    const t1 = Date.now()
    await expect(vfs.stat('file://srv/share/x')).rejects.toMatchObject({ code: 'FS_TIMEOUT' })
    const network = Date.now() - t1
    expect(asked).toEqual(['file:///C:/a', 'file://srv/share/x'])
    expect(local).toBeLessThan(150)
    expect(network).toBeGreaterThanOrEqual(190)
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
