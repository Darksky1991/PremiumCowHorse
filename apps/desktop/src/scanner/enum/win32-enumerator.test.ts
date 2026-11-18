import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LocalProvider } from '../../main/vfs/providers/local.provider'
import { createEnumerator } from './create-enumerator'
import type { Enumerator, RawEntry } from './types'
import { createWin32Enumerator } from './win32-enumerator'

const url = (p: string): string => pathToFileURL(p).href
const byName = (entries: RawEntry[]): Record<string, RawEntry> =>
  Object.fromEntries(entries.map((e) => [e.name, e]))
const noop = (): void => {}
const signal = (): AbortSignal => new AbortController().signal
const hoursAgo = (h: number): Date => new Date(Date.now() - h * 3600_000)

describe.runIf(process.platform === 'win32')('Win32Enumerator', () => {
  let root: string
  let log: ReturnType<typeof vi.fn<(msg: string) => void>>
  let en: Enumerator

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'pch-enum-'))
    log = vi.fn<(msg: string) => void>()
    en = createWin32Enumerator(log)
  })
  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  const list = (p: string): Promise<RawEntry[]> =>
    en.list(url(p), { signal: signal(), onBatch: noop })

  it('is reported as native and is what createEnumerator returns on Windows', () => {
    expect(en.native).toBe(true)
    expect(createEnumerator(log).native).toBe(true)
  })

  it('lists names, kinds, sizes and mtimes', async () => {
    writeFileSync(path.join(root, 'a.txt'), 'abc')
    mkdirSync(path.join(root, 'sub'))
    const entries = byName(await list(root))
    expect(Object.keys(entries).sort()).toEqual(['a.txt', 'sub'])
    const a = statSync(path.join(root, 'a.txt'))
    const sub = statSync(path.join(root, 'sub'))
    expect(entries['a.txt']).toMatchObject({ kind: 'file', size: 3, hidden: false })
    expect(entries['sub']).toMatchObject({ kind: 'directory', size: 0, hidden: false })
    expect(Math.abs(entries['a.txt']!.mtime - a.mtimeMs)).toBeLessThan(1)
    expect(Math.abs(entries['sub']!.mtime - sub.mtimeMs)).toBeLessThan(1)
    expect('target' in entries['a.txt']!).toBe(false)
    expect('target' in entries['sub']!).toBe(false)
  })

  it('marks HIDDEN as hidden and SYSTEM-only as visible', async () => {
    for (const n of ['h.txt', 's.txt', 'hs.txt', 'plain.txt', '.dot']) {
      writeFileSync(path.join(root, n), '')
    }
    execFileSync('attrib', ['+h', path.join(root, 'h.txt')])
    execFileSync('attrib', ['+s', path.join(root, 's.txt')])
    execFileSync('attrib', ['+h', '+s', path.join(root, 'hs.txt')])
    const entries = byName(await list(root))
    expect(entries['h.txt']!.hidden).toBe(true)
    expect(entries['hs.txt']!.hidden).toBe(true)
    expect(entries['s.txt']!.hidden).toBe(false)
    expect(entries['plain.txt']!.hidden).toBe(false)
    // Windows 以属性判断隐藏：以 . 开头但没有 HIDDEN 属性的项照常显示（与资源管理器一致）
    expect(entries['.dot']!.hidden).toBe(false)
  })

  it('reports junctions and symlinks as symlink with a target', async () => {
    const target = path.join(root, 'target')
    const gone = path.join(root, 'gone')
    const dir = path.join(root, 'dir')
    mkdirSync(target)
    mkdirSync(gone)
    mkdirSync(dir)
    execFileSync('cmd', ['/c', 'mklink', '/J', path.join(dir, 'j'), target])
    execFileSync('cmd', ['/c', 'mklink', '/J', path.join(dir, 'dead'), gone])
    rmSync(gone, { recursive: true })
    const entries = byName(await list(dir))
    expect(entries['j']).toMatchObject({ kind: 'symlink', target: 'directory', size: 0 })
    expect(entries['dead']).toMatchObject({ kind: 'symlink', target: null })
  })

  it('enumerates names with # % spaces and Japanese', async () => {
    const names = ['設計 #1 100%', 'a b.txt', '日本語フォルダ', '%E8%A8%AD.txt', '#hash.md'].sort()
    for (const n of names) {
      if (n.includes('.')) writeFileSync(path.join(root, n), 'x')
      else mkdirSync(path.join(root, n))
    }
    const entries = await list(root)
    expect(entries.map((e) => e.name).sort()).toEqual(names)
    // 与现有 LocalProvider（readdir）列出的名称完全一致：后续缓存以 URI 为键，名称不能有差异
    const viaFs = await new LocalProvider().list(pathToFileURL(root))
    expect(entries.map((e) => e.name).sort()).toEqual(viaFs.map((e) => e.name).sort())
  })

  it('enumerates a directory whose path exceeds 260 characters', async () => {
    let deep = root
    while (deep.length <= 280) deep = path.join(deep, 'd'.repeat(40))
    mkdirSync(deep, { recursive: true })
    writeFileSync(path.join(deep, 'deep.txt'), 'hello')
    expect(deep.length).toBeGreaterThan(260)
    const entries = byName(await list(deep))
    expect(entries['deep.txt']).toMatchObject({ kind: 'file', size: 5 })
    expect((await en.statDir(url(deep), signal())).mtime).toBeCloseTo(statSync(deep).mtimeMs, 3)
  })

  it("does not update the directory's last access time", async () => {
    writeFileSync(path.join(root, 'a.txt'), 'abc')
    mkdirSync(path.join(root, 'sub'))
    utimesSync(root, hoursAgo(3), hoursAgo(3))
    const before = statSync(root)
    await list(root)
    const after = statSync(root)
    expect(after.atimeMs).toBe(before.atimeMs)
    // 访问时间保护本身也不得改动其他时间
    expect(after.mtimeMs).toBe(before.mtimeMs)
    expect(after.ctimeMs).toBe(before.ctimeMs)
    expect(log).not.toHaveBeenCalled()
  })

  it('statDir returns the directory mtime and does not change atime', async () => {
    writeFileSync(path.join(root, 'a.txt'), 'abc')
    utimesSync(root, hoursAgo(3), hoursAgo(2))
    const before = statSync(root)
    const { mtime } = await en.statDir(url(root), signal())
    expect(mtime).toBe(before.mtimeMs)
    expect(statSync(root).atimeMs).toBe(before.atimeMs)
  })

  it('statDir follows a junction to its target directory', async () => {
    const target = path.join(root, 'target')
    mkdirSync(target)
    utimesSync(target, hoursAgo(5), hoursAgo(5))
    execFileSync('cmd', ['/c', 'mklink', '/J', path.join(root, 'j'), target])
    const { mtime } = await en.statDir(url(path.join(root, 'j')), signal())
    expect(mtime).toBe(statSync(target).mtimeMs)
  })

  it('calls onBatch at least once and honours an aborted signal', async () => {
    for (let i = 0; i < 2000; i++) writeFileSync(path.join(root, `file-${i}-${'x'.repeat(40)}`), '')
    const onBatch = vi.fn()
    const entries = await en.list(url(root), { signal: signal(), onBatch })
    expect(entries).toHaveLength(2000)
    // 64KB 缓冲放不下 2000 个约 100 字节的项：至少分两批
    expect(onBatch.mock.calls.length).toBeGreaterThanOrEqual(2)

    const aborted = AbortSignal.abort()
    await expect(en.list(url(root), { signal: aborted, onBatch: noop })).rejects.toMatchObject({
      code: 'FS_CANCELLED'
    })
    await expect(en.statDir(url(root), aborted)).rejects.toMatchObject({ code: 'FS_CANCELLED' })

    // 第一批之后中止：不再读取后续批次
    const ac = new AbortController()
    const stopAfterFirst = vi.fn(() => ac.abort())
    await expect(
      en.list(url(root), { signal: ac.signal, onBatch: stopAfterFirst })
    ).rejects.toMatchObject({ code: 'FS_CANCELLED' })
    expect(stopAfterFirst).toHaveBeenCalledTimes(1)
  })

  it('maps missing paths and files to error codes', async () => {
    writeFileSync(path.join(root, 'a.txt'), 'abc')
    await expect(list(path.join(root, 'missing'))).rejects.toMatchObject({ code: 'FS_NOT_FOUND' })
    await expect(list(path.join(root, 'missing', 'deeper'))).rejects.toMatchObject({
      code: 'FS_NOT_FOUND'
    })
    await expect(list(path.join(root, 'a.txt'))).rejects.toMatchObject({
      code: 'FS_NOT_A_DIRECTORY'
    })
    await expect(en.statDir(url(path.join(root, 'missing')), signal())).rejects.toMatchObject({
      code: 'FS_NOT_FOUND'
    })
    await expect(en.statDir(url(path.join(root, 'a.txt')), signal())).rejects.toMatchObject({
      code: 'FS_NOT_A_DIRECTORY'
    })
  })

  it('falls back to a read-only handle where attributes cannot be written, logging once', async () => {
    // 对当前用户拒绝「写入属性」（WA）：只能以只读句柄打开，访问时间无法保护
    const dir = path.join(root, 'locked')
    mkdirSync(dir)
    writeFileSync(path.join(dir, 'a.txt'), 'abc')
    // 以 SID 指定当前用户（Git Bash 的 whoami 会遮蔽系统的 whoami.exe，名称格式也因域而异）
    const whoami = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'whoami.exe')
    const sid = execFileSync(whoami, ['/user', '/fo', 'csv', '/nh'], { encoding: 'utf8' })
      .trim()
      .split(',')[1]!
      .replaceAll('"', '')
    const user = `*${sid}`
    execFileSync('icacls', [dir, '/deny', `${user}:(WA)`])
    try {
      expect(byName(await list(dir))['a.txt']).toMatchObject({ kind: 'file', size: 3 })
      await list(dir)
      expect(log).toHaveBeenCalledTimes(1)
      expect(log.mock.calls[0]![0]).toContain('access time')
    } finally {
      execFileSync('icacls', [dir, '/remove:d', user])
    }
  })

  it('delegates location keys to the shared locator', () => {
    expect(en.location('file:///C:/x')).toBe('local')
    expect(en.shareKey('file:///c:/x')).toBe('C:')
    expect(en.hostKey('file:///C:/x')).toBe('local')
    expect(en.location('file://Server/Share/dir')).toBe('network')
    expect(en.shareKey('file://Server/Share/dir')).toBe('\\\\server\\share')
    expect(en.hostKey('file://Server/Share/dir')).toBe('server')
  })
})
