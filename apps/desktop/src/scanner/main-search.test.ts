import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ScannerToMain } from '@pch/shared'
import { createScannerHost, type ScannerHost } from './main'

const url = (p: string): string => pathToFileURL(p).href

describe('scanner host search', () => {
  let tmp: string
  let posts: ScannerToMain[]
  let host: ScannerHost

  beforeEach(() => {
    tmp = mkdtempSync(path.join(tmpdir(), 'pch-scanner-search-'))
    posts = []
    host = createScannerHost({ post: (m) => posts.push(m), exit: vi.fn() })
  })
  afterEach(() => {
    try {
      host.handleMessage({ type: 'shutdown' })
    } finally {
      // 句柄刚关闭时删除可能暂时 EBUSY；force 只忽略 ENOENT，需要重试
      rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    }
  })

  const resultOf = async (id: number): Promise<Extract<ScannerToMain, { type: 'result' }>> =>
    vi.waitFor(() => {
      const r = posts.find((m) => m.type === 'result' && m.id === id)
      if (!r || r.type !== 'result') throw new Error(`no result for ${id} yet`)
      return r
    })

  it('answers search from the cache only (no file system access)', async () => {
    const root = path.join(tmp, 'root')
    mkdirSync(root, { recursive: true })
    writeFileSync(path.join(root, 'design-doc.txt'), 'x')
    host.handleMessage({ type: 'init', cacheFile: path.join(tmp, 'index.db') })
    host.handleMessage({
      type: 'configure',
      config: {
        roots: [
          { entryId: 'e1', workspaceId: 'w', uri: url(root), level: 'default', location: 'local' }
        ],
        allRootUris: [url(root)],
        indexTargets: [],
        settings: {
          intervalSec: { local: 5, network: 30 },
          backgroundIntervalMin: 10,
          timeoutSec: { local: 5, network: 10 },
          activeDepth: 3
        }
      }
    })
    host.handleMessage({ type: 'list', id: 1, uri: url(root) })
    await resultOf(1)
    // 删除文件后搜索仍返回缓存中的名称
    rmSync(path.join(root, 'design-doc.txt'))
    host.handleMessage({
      type: 'search',
      id: 2,
      scopes: [{ uri: url(root), entryId: 'e1', label: 'root' }],
      terms: [{ kind: 'contains', value: 'design' }],
      kind: 'all',
      showHidden: true,
      limit: 10
    })
    const r = await resultOf(2)
    expect(r.ok).toBe(true)
    const v = (r as { value: { items: { name: string; entryId: string }[]; total: number } }).value
    expect(v.items.map((i) => [i.name, i.entryId])).toEqual([['design-doc.txt', 'e1']])
    expect(v.total).toBe(1)
  })

  it('answers search with INDEX_UNAVAILABLE before init', async () => {
    host.handleMessage({
      type: 'search',
      id: 5,
      scopes: [],
      terms: [{ kind: 'contains', value: 'abc' }],
      kind: 'all',
      showHidden: false,
      limit: 10
    })
    expect(await resultOf(5)).toMatchObject({ ok: false, error: { code: 'INDEX_UNAVAILABLE' } })
  })
})
