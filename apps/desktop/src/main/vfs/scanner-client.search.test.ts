import { describe, expect, it, vi } from 'vitest'
import { AppError, type MainToScanner } from '@pch/shared'
import type { Logger } from '../infra/logger'
import { ScannerClient, type ScannerPort } from './scanner-client'

/** 搜索相关的 ScannerClient 行为（取消 = 丢弃旧结果） */
class FakePort implements ScannerPort {
  readonly sent: MainToScanner[] = []
  private readonly messageCbs: Array<(m: unknown) => void> = []
  private readonly exitCbs: Array<(c: number) => void> = []
  postMessage(m: unknown): void {
    this.sent.push(m as MainToScanner)
    if ((m as MainToScanner).type === 'shutdown') for (const cb of this.exitCbs) cb(0)
  }
  on(event: 'message', cb: (m: unknown) => void): void
  on(event: 'exit', cb: (code: number) => void): void
  on(event: 'message' | 'exit', cb: (x: never) => void): void {
    if (event === 'message') this.messageCbs.push(cb as never)
    else this.exitCbs.push(cb as never)
  }
  kill(): void {
    // 假实现：无需终止
  }
  emit(m: unknown): void {
    for (const cb of this.messageCbs) cb(m)
  }
  searchIds(): number[] {
    return this.sent.flatMap((m) => (m.type === 'search' ? [m.id] : []))
  }
}

function setup(): { client: ScannerClient; port: FakePort } {
  const port = new FakePort()
  const log = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }
  const client = new ScannerClient({
    fork: () => port,
    cacheFile: 'C:\\data\\cache\\index.db',
    onChanged: vi.fn(),
    onReachability: vi.fn(),
    log: log as unknown as Logger
  })
  client.start()
  return { client, port }
}

const codeOf = (p: Promise<unknown>): Promise<string> =>
  p.then(
    () => 'resolved',
    (e: unknown) => (e instanceof AppError ? e.code : `not an AppError: ${String(e)}`)
  )

const query = {
  scopes: [{ uri: 'file:///C:/a', entryId: 'e', label: 'A' }],
  terms: [{ kind: 'contains' as const, value: 'abc' }],
  kind: 'all' as const,
  showHidden: false,
  limit: 100
}
const result = { items: [], total: 0, truncated: false, indexedAt: null, incomplete: false }

describe('ScannerClient.search', () => {
  it('sends the query and resolves with the result', async () => {
    const { client, port } = setup()
    const p = client.search(query, 'search:1')
    const sent = port.sent.find((m) => m.type === 'search')
    expect(sent).toMatchObject({ type: 'search', ...query })
    port.emit({ type: 'result', id: port.searchIds()[0], ok: true, value: result })
    await expect(p).resolves.toEqual(result)
  })

  it('a new query with the same requestId rejects the old one (FS_CANCELLED) and ignores its late result', async () => {
    const { client, port } = setup()
    const old = client.search(query, 'search:1')
    const fresh = client.search(
      { ...query, terms: [{ kind: 'contains', value: 'xyz' }] },
      'search:1'
    )
    const [oldId, newId] = port.searchIds()
    await expect(codeOf(old)).resolves.toBe('FS_CANCELLED')
    port.emit({ type: 'result', id: oldId, ok: true, value: { ...result, total: 99 } })
    port.emit({ type: 'result', id: newId, ok: true, value: result })
    await expect(fresh).resolves.toEqual(result)
  })

  it('different requestIds do not cancel each other', async () => {
    const { client, port } = setup()
    const a = client.search(query, 'search:a')
    const b = client.search(query, 'search:b')
    const [ia, ib] = port.searchIds()
    port.emit({ type: 'result', id: ib, ok: true, value: result })
    port.emit({ type: 'result', id: ia, ok: true, value: result })
    await expect(a).resolves.toEqual(result)
    await expect(b).resolves.toEqual(result)
  })

  it('cancelSearch rejects with FS_CANCELLED; unknown ids are ignored; the id can be reused', async () => {
    const { client, port } = setup()
    const p = client.search(query, 'search:1')
    client.cancelSearch('nope')
    client.cancelSearch('search:1')
    await expect(codeOf(p)).resolves.toBe('FS_CANCELLED')
    const again = client.search(query, 'search:1')
    port.emit({ type: 'result', id: port.searchIds()[1], ok: true, value: result })
    await expect(again).resolves.toEqual(result)
  })

  it('rejects with INDEX_UNAVAILABLE when the scanner is not running', async () => {
    const { client } = setup()
    await client.dispose()
    await expect(codeOf(client.search(query, 'search:1'))).resolves.toBe('INDEX_UNAVAILABLE')
  })
})
