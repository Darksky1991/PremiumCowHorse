import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DirectoryListing, ScannerConfig, ScannerToMain } from '@pch/shared'
import { createScannerHost, type ScannerHost } from './main'

const url = (p: string): string => pathToFileURL(p).href

const settings: ScannerConfig['settings'] = {
  intervalSec: { local: 5, network: 30 },
  backgroundIntervalMin: 10,
  timeoutSec: { local: 5, network: 10 },
  activeDepth: 3
}

describe('scanner host (handleMessage)', () => {
  let tmp: string
  let posts: ScannerToMain[]
  let exit: ReturnType<typeof vi.fn<(code: number) => void>>
  let host: ScannerHost

  beforeEach(() => {
    tmp = mkdtempSync(path.join(tmpdir(), 'pch-scanner-'))
    posts = []
    exit = vi.fn<(code: number) => void>()
    host = createScannerHost({ post: (m) => posts.push(m), exit })
  })
  afterEach(() => {
    host.handleMessage({ type: 'shutdown' })
    rmSync(tmp, { recursive: true, force: true })
  })

  const resultOf = async (id: number): Promise<Extract<ScannerToMain, { type: 'result' }>> =>
    vi.waitFor(() => {
      const r = posts.find((m) => m.type === 'result' && m.id === id)
      if (!r || r.type !== 'result') throw new Error(`no result for ${id} yet`)
      return r
    })

  it('lists a real directory through init → configure → list', async () => {
    const root = path.join(tmp, 'root')
    mkdirSync(path.join(root, 'sub'), { recursive: true })
    writeFileSync(path.join(root, 'a.txt'), 'hello')

    host.handleMessage({ type: 'init', cacheFile: path.join(tmp, 'cache', 'index.db') })
    expect(posts).toContainEqual({ type: 'ready' })
    host.handleMessage({
      type: 'configure',
      config: {
        roots: [
          { entryId: 'e1', workspaceId: 'w', uri: url(root), level: 'default', location: 'local' }
        ],
        allRootUris: [url(root)],
        indexTargets: [],
        settings
      }
    })
    host.handleMessage({ type: 'list', id: 1, uri: url(root) })

    const r = await resultOf(1)
    expect(r.ok).toBe(true)
    const listing = (r as { value: DirectoryListing }).value
    expect(listing.state).toBe('fresh')
    expect(listing.items.map((i) => [i.name, i.kind]).sort()).toEqual([
      ['a.txt', 'file'],
      ['sub', 'directory']
    ])
    expect(listing.items.find((i) => i.name === 'a.txt')).toMatchObject({
      uri: url(path.join(root, 'a.txt')),
      size: 5
    })

    host.handleMessage({ type: 'cacheInfo', id: 2 })
    const info = await resultOf(2)
    expect(info.ok && (info.value as { bytes: number }).bytes).toBeGreaterThan(0)
  })

  it('reports an error result for a missing directory', async () => {
    host.handleMessage({ type: 'init', cacheFile: path.join(tmp, 'index.db') })
    host.handleMessage({ type: 'list', id: 7, uri: url(path.join(tmp, 'missing')) })
    const r = await resultOf(7)
    expect(r).toMatchObject({ ok: false, error: { code: 'FS_NOT_FOUND' } })
  })

  it('logs and ignores invalid messages', () => {
    host.handleMessage({ type: 'list', id: 'x' })
    host.handleMessage('garbage')
    expect(posts.filter((m) => m.type === 'log' && m.level === 'warn')).toHaveLength(2)
    expect(posts.some((m) => m.type === 'result')).toBe(false)
  })

  it('rebuilds a corrupted cache file once', async () => {
    const cacheFile = path.join(tmp, 'index.db')
    writeFileSync(cacheFile, 'this is definitely not a sqlite database '.repeat(200))
    writeFileSync(`${cacheFile}-wal`, 'garbage')

    host.handleMessage({ type: 'init', cacheFile })

    expect(posts).toContainEqual({ type: 'ready' })
    expect(posts.some((m) => m.type === 'log' && m.level === 'warn')).toBe(true)
    host.handleMessage({ type: 'cacheInfo', id: 1 })
    expect((await resultOf(1)).ok).toBe(true)
  })

  it('answers every request with INDEX_UNAVAILABLE when the cache cannot be opened', async () => {
    // 缓存路径是一个目录：既打不开，也不会被删除（只删文件）
    const cacheFile = path.join(tmp, 'index.db')
    mkdirSync(path.join(cacheFile, 'keep'), { recursive: true })

    host.handleMessage({ type: 'init', cacheFile })

    expect(posts).not.toContainEqual({ type: 'ready' })
    expect(posts.some((m) => m.type === 'log' && m.level === 'error')).toBe(true)
    host.handleMessage({ type: 'list', id: 1, uri: url(tmp) })
    host.handleMessage({ type: 'cacheInfo', id: 2 })
    host.handleMessage({ type: 'clearCache', id: 3 })
    for (const id of [1, 2, 3]) {
      expect(await resultOf(id)).toMatchObject({ ok: false, error: { code: 'INDEX_UNAVAILABLE' } })
    }
  })

  it('answers requests that arrive before init with INDEX_UNAVAILABLE', async () => {
    host.handleMessage({ type: 'list', id: 4, uri: url(tmp) })
    expect(await resultOf(4)).toMatchObject({ ok: false, error: { code: 'INDEX_UNAVAILABLE' } })
  })

  it('exits on shutdown', () => {
    host.handleMessage({ type: 'init', cacheFile: path.join(tmp, 'index.db') })
    host.handleMessage({ type: 'shutdown' })
    expect(exit).toHaveBeenCalledWith(0)
  })
})
