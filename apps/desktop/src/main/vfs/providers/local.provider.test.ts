import fs from 'node:fs/promises'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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
})
