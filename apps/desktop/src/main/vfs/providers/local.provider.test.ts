import { EventEmitter } from 'node:events'
import fs from 'node:fs/promises'
import fsSync, { mkdirSync, mkdtempSync, rmSync, writeFileSync, type FSWatcher } from 'node:fs'
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
    rmSync(root, { recursive: true, force: true })
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

  describe('watch', () => {
    const waitFor = async (cond: () => boolean): Promise<void> => {
      const end = Date.now() + 2000
      while (!cond() && Date.now() < end) await new Promise((r) => setTimeout(r, 25))
    }

    it('calls back when a file is created in the watched directory', async () => {
      const onChange = vi.fn()
      const w = provider.watch(url(dir), onChange)
      try {
        writeFileSync(path.join(dir, 'new.txt'), 'x')
        await waitFor(() => onChange.mock.calls.length > 0)
        expect(onChange).toHaveBeenCalled()
      } finally {
        w.close()
      }
    })

    it('notifies and reports invalidation when the watched directory is deleted, and can be re-created', async () => {
      const onChange = vi.fn()
      const onClose = vi.fn()
      const uncaught = vi.fn()
      process.on('uncaughtException', uncaught)
      try {
        const w = provider.watch(url(dir), onChange, onClose)
        rmSync(dir, { recursive: true, force: true })
        await waitFor(() => onChange.mock.calls.length > 0)
        expect(onChange).toHaveBeenCalled()
        // 部分平台先给 rename 再给 error：等待失效通知
        await waitFor(() => onClose.mock.calls.length > 0)
        expect(onClose).toHaveBeenCalledTimes(1)
        expect(() => w.close()).not.toThrow()
        expect(uncaught).not.toHaveBeenCalled()

        // 同路径重建后可再次监听并收到回调
        mkdirSync(dir)
        const again = vi.fn()
        const w2 = provider.watch(url(dir), again)
        try {
          writeFileSync(path.join(dir, 'x.txt'), 'x')
          await waitFor(() => again.mock.calls.length > 0)
          expect(again).toHaveBeenCalled()
        } finally {
          w2.close()
        }
      } finally {
        process.off('uncaughtException', uncaught)
      }
    })

    it('does not call onClose when the caller closes the watch', () => {
      const onClose = vi.fn()
      provider.watch(url(dir), () => undefined, onClose).close()
      expect(onClose).not.toHaveBeenCalled()
    })

    /** 替换 fs.watch 为可手动发出事件的假 watcher（真实 fs 上难以在目录仍存在时触发异步 error） */
    const fakeWatcher = (): EventEmitter & { close: ReturnType<typeof vi.fn> } => {
      const fake = Object.assign(new EventEmitter(), { close: vi.fn() })
      vi.spyOn(fsSync, 'watch').mockReturnValue(fake as unknown as FSWatcher)
      return fake
    }
    const watchError = (): Error => Object.assign(new Error('watch failed'), { code: 'EPERM' })

    it('on an async watcher error while the directory still exists, only reports invalidation', async () => {
      const fake = fakeWatcher()
      const onChange = vi.fn()
      const onClose = vi.fn()
      provider.watch(url(dir), onChange, onClose)
      // 例如不支持变更通知的 NAS：fs.watch 同步成功，随后异步报错，目录本身仍然可以列出
      fake.emit('error', watchError())
      await waitFor(() => onClose.mock.calls.length > 0)
      expect(onClose).toHaveBeenCalledTimes(1)
      expect(fake.close).toHaveBeenCalled()
      // 不通知变化：否则调用方重新列出并重发集合，监听重建后再次报错，形成循环
      expect(onChange).not.toHaveBeenCalled()
    })

    it('on an async watcher error after the directory is gone, notifies a change then invalidation', async () => {
      const fake = fakeWatcher()
      const calls: string[] = []
      provider.watch(
        url(dir),
        () => calls.push('change'),
        () => calls.push('close')
      )
      rmSync(dir, { recursive: true, force: true })
      fake.emit('error', watchError())
      await waitFor(() => calls.includes('close'))
      expect(calls).toEqual(['change', 'close'])
    })

    it('does not report invalidation when the caller closes while the error is being checked', async () => {
      const fake = fakeWatcher()
      const onChange = vi.fn()
      const onClose = vi.fn()
      const w = provider.watch(url(dir), onChange, onClose)
      fake.emit('error', watchError())
      w.close()
      await new Promise((r) => setTimeout(r, 100))
      expect(onClose).not.toHaveBeenCalled()
      expect(onChange).not.toHaveBeenCalled()
    })

    it('returns a no-op handle and reports invalidation for an unwatchable path', () => {
      const onClose = vi.fn()
      const w = provider.watch(url(path.join(root, 'missing')), () => undefined, onClose)
      expect(() => w.close()).not.toThrow()
      expect(onClose).toHaveBeenCalledTimes(1)
    })
  })
})
