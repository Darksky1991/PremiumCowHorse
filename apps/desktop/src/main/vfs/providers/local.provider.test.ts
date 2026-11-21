import fs from 'node:fs/promises'
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LocalProvider } from './local.provider'

describe('LocalProvider', () => {
  let root: string
  let dir: string
  const provider = new LocalProvider()
  const url = (p: string): URL => pathToFileURL(p)

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'pch-local-'))
    dir = path.join(root, '案件 A')
    mkdirSync(path.join(dir, 'sub'), { recursive: true })
    writeFileSync(path.join(dir, '設計書#1.xlsx'), 'abc')
    writeFileSync(path.join(dir, '.hidden'), '')
  })
  afterEach(() => {
    vi.restoreAllMocks()
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  })

  it('lists files and folders with kind, size and hidden flags', async () => {
    const entries = await provider.list(url(dir))
    const byName = Object.fromEntries(entries.map((e) => [e.name, e]))
    expect(Object.keys(byName).sort()).toEqual(['.hidden', 'sub', '設計書#1.xlsx'])
    expect(byName['設計書#1.xlsx']).toMatchObject({ kind: 'file', size: 3, hidden: false })
    expect(byName['sub']).toMatchObject({ kind: 'directory', hidden: false })
    expect(byName['.hidden']).toMatchObject({ kind: 'file', hidden: true })
  })

  it('resolves the target kind of junctions, and null for a dangling one', async () => {
    const live = path.join(dir, 'link-live')
    const dead = path.join(dir, 'link-dead')
    const gone = path.join(root, 'gone')
    mkdirSync(gone)
    await fs.symlink(path.join(dir, 'sub'), live, 'junction')
    await fs.symlink(gone, dead, 'junction')
    rmSync(gone, { recursive: true })
    const byName = Object.fromEntries((await provider.list(url(dir))).map((e) => [e.name, e]))
    expect(byName['link-live']).toMatchObject({ kind: 'symlink', target: 'directory' })
    expect(byName['link-dead']).toMatchObject({ kind: 'symlink', target: null })
    expect('target' in byName['設計書#1.xlsx']!).toBe(false)
    expect('target' in byName['sub']!).toBe(false)
  })

  it('returns child URIs that can be stat-ed again (Japanese, spaces, #)', async () => {
    for (const e of await provider.list(url(dir))) {
      const stat = await provider.stat(new URL(e.uri))
      expect(stat.name).toBe(e.name)
      expect(fileURLToPath(e.uri)).toBe(path.join(dir, e.name))
    }
  })

  it('names a drive root after the drive instead of an empty string', async () => {
    const driveRoot = path.parse(root).root // 例如 C:\\
    const stat = await provider.stat(url(driveRoot))
    expect(stat.name).toBe(driveRoot.replace(/\\$/, ''))
  })

  it('maps a missing path to FS_NOT_FOUND', async () => {
    await expect(provider.list(url(path.join(root, 'nope')))).rejects.toMatchObject({
      code: 'FS_NOT_FOUND'
    })
    await expect(provider.stat(url(path.join(root, 'nope')))).rejects.toMatchObject({
      code: 'FS_NOT_FOUND'
    })
  })

  it('maps listing a file to FS_NOT_A_DIRECTORY', async () => {
    await expect(provider.list(url(path.join(dir, '設計書#1.xlsx')))).rejects.toMatchObject({
      code: 'FS_NOT_A_DIRECTORY'
    })
  })

  it('maps an aborted signal to FS_CANCELLED', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(provider.list(url(dir), controller.signal)).rejects.toMatchObject({
      code: 'FS_CANCELLED'
    })
  })

  it('round-trips UNC paths through file URIs', () => {
    const unc = '\\\\server\\share\\dir'
    expect(pathToFileURL(unc).href).toBe('file://server/share/dir')
    expect(fileURLToPath(pathToFileURL(unc).href)).toBe(unc)
  })

  it('keeps an entry that exists but cannot be read, degraded instead of dropped', async () => {
    const realLstat = fs.lstat
    vi.spyOn(fs, 'lstat').mockImplementation(async (p, ...rest) => {
      if (String(p).endsWith('設計書#1.xlsx')) {
        throw Object.assign(new Error('denied'), { code: 'EPERM' })
      }
      return realLstat(p, ...rest)
    })
    const byName = Object.fromEntries((await provider.list(url(dir))).map((e) => [e.name, e]))
    expect(byName['設計書#1.xlsx']).toMatchObject({ kind: 'file', size: 0, mtime: 0 })
  })

  it('stats at most 16 children concurrently', async () => {
    for (let i = 0; i < 100; i++) writeFileSync(path.join(dir, `f${i}.txt`), '')
    const realLstat = fs.lstat
    let inFlight = 0
    let maxInFlight = 0
    vi.spyOn(fs, 'lstat').mockImplementation(async (p, ...rest) => {
      inFlight++
      maxInFlight = Math.max(maxInFlight, inFlight)
      await new Promise((r) => setTimeout(r, 1))
      try {
        return await realLstat(p, ...rest)
      } finally {
        inFlight--
      }
    })
    expect(await provider.list(url(dir))).toHaveLength(103)
    expect(maxInFlight).toBeLessThanOrEqual(16)
  })

  it('stops starting new stats once the signal is aborted', async () => {
    for (let i = 0; i < 200; i++) writeFileSync(path.join(dir, `f${i}.txt`), '')
    const controller = new AbortController()
    const realLstat = fs.lstat
    let calls = 0
    vi.spyOn(fs, 'lstat').mockImplementation(async (p, ...rest) => {
      if (++calls === 20) controller.abort()
      return realLstat(p, ...rest)
    })
    await expect(provider.list(url(dir), controller.signal)).rejects.toMatchObject({
      code: 'FS_CANCELLED'
    })
    expect(calls).toBeLessThan(50)
  })

  it('skips an entry that disappears while listing instead of failing the whole list', async () => {
    const realLstat = fs.lstat
    vi.spyOn(fs, 'lstat').mockImplementation(async (p, ...rest) => {
      if (String(p).endsWith('sub')) {
        throw Object.assign(new Error('gone'), { code: 'ENOENT' })
      }
      return realLstat(p, ...rest)
    })
    const names = (await provider.list(url(dir))).map((e) => e.name).sort()
    expect(names).toEqual(['.hidden', '設計書#1.xlsx'])
  })

  describe('read', () => {
    const bytes = Uint8Array.from({ length: 1000 }, (_, i) => i % 251)
    let file: string
    beforeEach(() => {
      file = path.join(dir, 'data.bin')
      writeFileSync(file, bytes)
    })

    it('reads [offset, offset + length)', async () => {
      expect(await provider.read(url(file), 0, 10)).toEqual(bytes.subarray(0, 10))
      expect(await provider.read(url(file), 300, 400)).toEqual(bytes.subarray(300, 700))
    })

    it('returns fewer bytes at the end of the file and none past it', async () => {
      expect(await provider.read(url(file), 990, 100)).toEqual(bytes.subarray(990))
      expect(await provider.read(url(file), 1000, 10)).toEqual(new Uint8Array(0))
      expect(await provider.read(url(file), 5000, 10)).toEqual(new Uint8Array(0))
      expect(await provider.read(url(file), 10, 0)).toEqual(new Uint8Array(0))
    })

    it('rejects a negative or fractional range', async () => {
      await expect(provider.read(url(file), -1, 10)).rejects.toThrow(RangeError)
      await expect(provider.read(url(file), 0, 1.5)).rejects.toThrow(RangeError)
    })

    it('maps a missing file to FS_NOT_FOUND', async () => {
      await expect(provider.read(url(path.join(dir, 'nope.txt')), 0, 10)).rejects.toMatchObject({
        code: 'FS_NOT_FOUND'
      })
    })

    it('maps an aborted signal to FS_CANCELLED', async () => {
      const controller = new AbortController()
      controller.abort()
      await expect(provider.read(url(file), 0, 10, controller.signal)).rejects.toMatchObject({
        code: 'FS_CANCELLED'
      })
    })

    it('closes the file right after reading: the file and its folder can be renamed', async () => {
      await provider.read(url(file), 0, 10)
      renameSync(file, path.join(dir, 'renamed.bin'))
      renameSync(dir, path.join(root, '案件 B'))
      await expect(provider.read(url(file), 0, 10)).rejects.toMatchObject({
        code: 'FS_NOT_FOUND'
      })
    })

    it('closes the file when the read fails', async () => {
      const close = vi.fn()
      const realOpen = fs.open
      vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
        const handle = await realOpen(...args)
        const realClose = handle.close.bind(handle)
        handle.read = (() =>
          Promise.reject(Object.assign(new Error('io'), { code: 'EIO' }))) as never
        handle.close = async () => {
          close()
          return realClose()
        }
        return handle
      })
      await expect(provider.read(url(file), 0, 10)).rejects.toMatchObject({
        code: 'FS_UNAVAILABLE'
      })
      expect(close).toHaveBeenCalledOnce()
    })
  })

  describe('createReadStream', () => {
    const bytes = Uint8Array.from({ length: 200_000 }, (_, i) => i % 251)
    let file: string
    beforeEach(() => {
      file = path.join(dir, 'big.bin')
      writeFileSync(file, bytes)
    })

    async function collect(stream: NodeJS.ReadableStream): Promise<Buffer> {
      const chunks: Buffer[] = []
      for await (const c of stream) chunks.push(Buffer.from(c as Uint8Array))
      return Buffer.concat(chunks)
    }

    it('streams the whole file', async () => {
      const data = await collect(await provider.createReadStream(url(file)))
      expect(data.equals(Buffer.from(bytes))).toBe(true)
    })

    it('streams an inclusive byte range', async () => {
      const data = await collect(await provider.createReadStream(url(file), { start: 10, end: 19 }))
      expect(data.equals(Buffer.from(bytes.subarray(10, 20)))).toBe(true)
    })

    it('maps a missing file to FS_NOT_FOUND', async () => {
      await expect(
        provider.createReadStream(url(path.join(dir, 'nope.bin')))
      ).rejects.toMatchObject({ code: 'FS_NOT_FOUND' })
    })

    it('maps an already aborted signal to FS_CANCELLED', async () => {
      const controller = new AbortController()
      controller.abort()
      await expect(
        provider.createReadStream(url(file), undefined, controller.signal)
      ).rejects.toMatchObject({ code: 'FS_CANCELLED' })
    })

    it('closes the file after the stream ends: the folder can be renamed at once', async () => {
      await collect(await provider.createReadStream(url(file)))
      renameSync(dir, path.join(root, '案件 B'))
    })

    it('closes the file when the stream is destroyed early', async () => {
      const stream = await provider.createReadStream(url(file))
      await new Promise<void>((resolve) => stream.once('data', () => resolve()))
      ;(stream as unknown as { destroy(): void }).destroy()
      await new Promise((r) => setTimeout(r, 50))
      renameSync(dir, path.join(root, '案件 B'))
    })

    it('closes the file when the signal aborts while streaming', async () => {
      const controller = new AbortController()
      const stream = await provider.createReadStream(url(file), undefined, controller.signal)
      await new Promise<void>((resolve) => stream.once('data', () => resolve()))
      const closed = new Promise<void>((resolve) => stream.once('close', () => resolve()))
      stream.on('error', () => undefined)
      controller.abort()
      await closed
      renameSync(dir, path.join(root, '案件 B'))
    })
  })
})
