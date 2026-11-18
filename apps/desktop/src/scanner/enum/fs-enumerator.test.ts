import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FsEnumerator } from './fs-enumerator'
import type { RawEntry } from './types'

const url = (p: string): string => pathToFileURL(p).href
const byName = (entries: RawEntry[]): Record<string, RawEntry> =>
  Object.fromEntries(entries.map((e) => [e.name, e]))
const noop = (): void => {}
const signal = (): AbortSignal => new AbortController().signal

describe('FsEnumerator', () => {
  let root: string
  const en = new FsEnumerator()

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'pch-fsenum-'))
  })
  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  const list = (p: string): Promise<RawEntry[]> =>
    en.list(url(p), { signal: signal(), onBatch: noop })

  it('is not native', () => {
    expect(en.native).toBe(false)
  })

  it('lists names, kinds, sizes and mtimes', async () => {
    writeFileSync(path.join(root, 'a.txt'), 'abc')
    mkdirSync(path.join(root, 'sub'))
    const entries = byName(await list(root))
    expect(Object.keys(entries).sort()).toEqual(['a.txt', 'sub'])
    expect(entries['a.txt']).toMatchObject({ kind: 'file', size: 3, hidden: false })
    expect(entries['sub']).toMatchObject({ kind: 'directory', size: 0, hidden: false })
    expect(entries['a.txt']!.mtime).toBe(statSync(path.join(root, 'a.txt')).mtimeMs)
    expect('target' in entries['a.txt']!).toBe(false)
  })

  it('treats names starting with a dot as hidden', async () => {
    writeFileSync(path.join(root, '.hidden'), '')
    writeFileSync(path.join(root, 'shown'), '')
    const entries = byName(await list(root))
    expect(entries['.hidden']!.hidden).toBe(true)
    expect(entries['shown']!.hidden).toBe(false)
  })

  it('reports junctions as symlink with a target, and null for a dangling one', async () => {
    const target = path.join(root, 'target')
    const gone = path.join(root, 'gone')
    const dir = path.join(root, 'dir')
    mkdirSync(target)
    mkdirSync(gone)
    mkdirSync(dir)
    symlinkSync(target, path.join(dir, 'j'), 'junction')
    symlinkSync(gone, path.join(dir, 'dead'), 'junction')
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
    expect((await list(root)).map((e) => e.name).sort()).toEqual(names)
  })

  it('statDir returns the directory mtime', async () => {
    utimesSync(root, new Date(Date.now() - 3600_000), new Date(Date.now() - 7200_000))
    expect((await en.statDir(url(root), signal())).mtime).toBe(statSync(root).mtimeMs)
  })

  it('calls onBatch at least once and honours an aborted signal', async () => {
    writeFileSync(path.join(root, 'a.txt'), 'abc')
    const onBatch = vi.fn()
    await en.list(url(root), { signal: signal(), onBatch })
    expect(onBatch).toHaveBeenCalled()
    const aborted = AbortSignal.abort()
    await expect(en.list(url(root), { signal: aborted, onBatch: noop })).rejects.toMatchObject({
      code: 'FS_CANCELLED'
    })
    await expect(en.statDir(url(root), aborted)).rejects.toMatchObject({ code: 'FS_CANCELLED' })
  })

  it('maps missing paths and files to error codes', async () => {
    writeFileSync(path.join(root, 'a.txt'), 'abc')
    await expect(list(path.join(root, 'missing'))).rejects.toMatchObject({ code: 'FS_NOT_FOUND' })
    await expect(list(path.join(root, 'a.txt'))).rejects.toMatchObject({
      code: 'FS_NOT_A_DIRECTORY'
    })
    await expect(en.statDir(url(path.join(root, 'a.txt')), signal())).rejects.toMatchObject({
      code: 'FS_NOT_A_DIRECTORY'
    })
  })
})
