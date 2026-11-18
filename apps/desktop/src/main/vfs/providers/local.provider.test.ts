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
