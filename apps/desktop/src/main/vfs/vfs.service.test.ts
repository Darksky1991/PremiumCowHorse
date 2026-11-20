import { PassThrough, Readable } from 'node:stream'
import { describe, expect, it } from 'vitest'
import type { FileEntry, FileStat } from '@pch/shared'
import { VfsService } from './vfs.service'
import type { FileSystemProvider } from './types'

/** list 永不完成（也不响应 signal），模拟无响应的网络共享 */
class HangingProvider implements FileSystemProvider {
  readonly scheme = 'file' as const
  stat(): Promise<FileStat> {
    return new Promise(() => undefined)
  }
  list(): Promise<FileEntry[]> {
    return new Promise(() => undefined)
  }
  read(): Promise<Uint8Array> {
    return new Promise(() => undefined)
  }
  createReadStream(): Promise<NodeJS.ReadableStream> {
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

  it('routes read to the provider with the range', async () => {
    const echo: FileSystemProvider = {
      scheme: 'file',
      stat: () => new Promise(() => undefined),
      list: () => new Promise(() => undefined),
      read: async (_uri, offset, length) => Uint8Array.of(offset, length),
      createReadStream: () => new Promise(() => undefined),
      dispose: async () => undefined
    }
    const vfs = new VfsService([echo])
    expect(await vfs.read('file:///C:/a.log', 3, 4)).toEqual(Uint8Array.of(3, 4))
  })

  it('times out a read that never completes', async () => {
    const vfs = new VfsService([new HangingProvider()], { timeoutMs: 30 })
    await expect(vfs.read('file:///C:/a.log', 0, 10)).rejects.toMatchObject({
      code: 'FS_TIMEOUT'
    })
  })

  it('cancels a read when the caller aborts its signal, passing the reason through', async () => {
    const vfs = new VfsService([new HangingProvider()], { timeoutMs: 1000 })
    const controller = new AbortController()
    const pending = vfs.read('file:///C:/a.log', 0, 10, controller.signal)
    controller.abort()
    await expect(pending).rejects.toMatchObject({ code: 'FS_CANCELLED' })
    const already = new AbortController()
    already.abort()
    await expect(vfs.read('file:///C:/a.log', 0, 10, already.signal)).rejects.toMatchObject({
      code: 'FS_CANCELLED'
    })
  })

  it('cancelling an unknown id is a no-op', () => {
    expect(() => new VfsService([]).cancel('nope')).not.toThrow()
  })

  describe('createReadStream', () => {
    function provider(open: (signal?: AbortSignal) => Promise<Readable>): FileSystemProvider {
      return {
        scheme: 'file',
        stat: () => new Promise(() => undefined),
        list: () => new Promise(() => undefined),
        read: () => new Promise(() => undefined),
        createReadStream: (_uri, _range, signal) => open(signal),
        dispose: async () => undefined
      }
    }

    it('routes to the provider with the range', async () => {
      const seen: unknown[] = []
      const p = provider(async () => Readable.from([Buffer.from('x')]))
      p.createReadStream = async (uri, range) => {
        seen.push(uri.href, range)
        return Readable.from([Buffer.from('x')])
      }
      const stream = await new VfsService([p]).createReadStream('file:///C:/a.bin', {
        start: 1,
        end: 2
      })
      expect(seen).toEqual(['file:///C:/a.bin', { start: 1, end: 2 }])
      ;(stream as Readable).destroy()
    })

    it('times out while opening (by location)', async () => {
      const vfs = new VfsService([provider(() => new Promise(() => undefined))], { timeoutMs: 30 })
      await expect(vfs.createReadStream('file:///C:/a.bin')).rejects.toMatchObject({
        code: 'FS_TIMEOUT'
      })
    })

    it('does not time out an open stream that is still being read', async () => {
      const source = new PassThrough()
      const vfs = new VfsService([provider(async () => source)], { timeoutMs: 30 })
      const stream = await vfs.createReadStream('file:///C:/a.bin')
      await new Promise((r) => setTimeout(r, 80))
      expect((stream as Readable).destroyed).toBe(false)
      source.destroy()
    })

    it('destroys the stream when the caller aborts after it was opened', async () => {
      const source = new PassThrough()
      const vfs = new VfsService([provider(async () => source)])
      const controller = new AbortController()
      const stream = (await vfs.createReadStream(
        'file:///C:/a.bin',
        undefined,
        controller.signal
      )) as Readable
      stream.on('error', () => undefined)
      controller.abort()
      await new Promise((r) => setTimeout(r, 10))
      expect(stream.destroyed).toBe(true)
    })

    it('destroys a stream that opens only after the call timed out', async () => {
      const source = new PassThrough()
      let release!: () => void
      const gate = new Promise<void>((r) => (release = r))
      const vfs = new VfsService(
        [
          provider(async () => {
            await gate
            return source
          })
        ],
        { timeoutMs: 20 }
      )
      await expect(vfs.createReadStream('file:///C:/a.bin')).rejects.toMatchObject({
        code: 'FS_TIMEOUT'
      })
      release()
      await new Promise((r) => setTimeout(r, 10))
      expect(source.destroyed).toBe(true)
    })
  })
})
