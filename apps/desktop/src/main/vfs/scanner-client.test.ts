import { describe, expect, it, vi } from 'vitest'
import { AppError, type MainToScanner, type ScannerConfig } from '@pch/shared'
import type { Logger } from '../infra/logger'
import { ScannerClient, type ScannerPort } from './scanner-client'

class FakePort implements ScannerPort {
  readonly sent: MainToScanner[] = []
  readonly kill = vi.fn(() => this.exit(0))
  private readonly listeners: {
    message: Array<(m: unknown) => void>
    exit: Array<(c: number) => void>
  } = { message: [], exit: [] }
  /** true：收到 shutdown 时自行退出（模拟扫描进程） */
  exitOnShutdown = true

  postMessage(m: unknown): void {
    this.sent.push(m as MainToScanner)
    if (this.exitOnShutdown && (m as MainToScanner).type === 'shutdown') this.exit(0)
  }
  on(event: 'message', cb: (m: unknown) => void): void
  on(event: 'exit', cb: (code: number) => void): void
  on(event: 'message' | 'exit', cb: (x: never) => void): void {
    this.listeners[event].push(cb as never)
  }
  emit(m: unknown): void {
    for (const cb of this.listeners.message) cb(m)
  }
  exit(code: number): void {
    for (const cb of this.listeners.exit) cb(code)
  }
  /** 最近一条指定类型的请求 */
  last<T extends MainToScanner['type']>(type: T): Extract<MainToScanner, { type: T }> {
    const m = [...this.sent].reverse().find((x) => x.type === type)
    if (!m) throw new Error(`no ${type} sent`)
    return m as Extract<MainToScanner, { type: T }>
  }
}

const config: ScannerConfig = {
  roots: [
    { entryId: 'e', workspaceId: 'w', uri: 'file:///C:/a', level: 'default', location: 'local' }
  ],
  allRootUris: ['file:///C:/a'],
  indexTargets: [],
  settings: {
    intervalSec: { local: 5, network: 30 },
    backgroundIntervalMin: 10,
    timeoutSec: { local: 5, network: 10 },
    activeDepth: 3
  }
}

const listing = (name: string): unknown => ({
  items: [{ uri: `file:///C:/a/${name}`, name, kind: 'file', size: 1, mtime: 1, hidden: false }],
  state: 'fresh',
  checkedAt: 1
})

type Fn = ReturnType<typeof vi.fn>

interface Setup {
  client: ScannerClient
  fork: Fn
  ports: FakePort[]
  port: () => FakePort
  log: Record<'error' | 'warn' | 'info' | 'debug', Fn>
  onChanged: Fn
  onReachability: Fn
}

function setup(opts: { now?: () => number } = {}): Setup {
  const ports: FakePort[] = []
  const fork = vi.fn((): FakePort => {
    const p = new FakePort()
    ports.push(p)
    return p
  })
  const log = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }
  const onChanged = vi.fn()
  const onReachability = vi.fn()
  const client = new ScannerClient({
    fork,
    cacheFile: 'C:\\data\\cache\\index.db',
    onChanged,
    onReachability,
    log: log as unknown as Logger,
    now: opts.now
  })
  client.start()
  const port = (): FakePort => ports[ports.length - 1]!
  return { client, fork, ports, port, log, onChanged, onReachability }
}

const codeOf = (p: Promise<unknown>): Promise<string> =>
  p.then(
    () => 'resolved',
    (e: unknown) => (e instanceof AppError ? e.code : `not an AppError: ${String(e)}`)
  )

describe('ScannerClient', () => {
  it('sends init with the cache file first', () => {
    const { port } = setup()
    expect(port().sent[0]).toEqual({ type: 'init', cacheFile: 'C:\\data\\cache\\index.db' })
  })

  it('correlates results by id', async () => {
    const { client, port } = setup()
    const a = client.list('file:///C:/a')
    const b = client.list('file:///C:/b')
    const info = client.cacheInfo()
    const [ra, rb] = port().sent.filter((m) => m.type === 'list') as Array<
      Extract<MainToScanner, { type: 'list' }>
    >
    expect(ra!.uri).toBe('file:///C:/a')
    expect(ra!.id).not.toBe(rb!.id)
    // 乱序回应
    port().emit({ type: 'result', id: port().last('cacheInfo').id, ok: true, value: { bytes: 42 } })
    port().emit({ type: 'result', id: rb!.id, ok: true, value: listing('b.txt') })
    port().emit({
      type: 'result',
      id: ra!.id,
      ok: false,
      error: { code: 'FS_NOT_FOUND', detail: 'gone' }
    })
    await expect(info).resolves.toEqual({ bytes: 42 })
    await expect(b).resolves.toEqual(listing('b.txt'))
    await expect(codeOf(a)).resolves.toBe('FS_NOT_FOUND')
  })

  it('pending requests reject when the scanner exits and the client restarts it', async () => {
    const { client, fork, port, ports, log } = setup()
    client.configure(config)
    client.windowFocus(5, false)
    client.interest(5, { focus: 'file:///C:/a', visible: [], offscreen: [] })
    const pending = client.list('file:///C:/a')

    ports[0]!.exit(1)

    await expect(codeOf(pending)).resolves.toBe('INDEX_UNAVAILABLE')
    expect(fork).toHaveBeenCalledTimes(2)
    expect(log.warn).toHaveBeenCalled()
    // 新进程：init → 最后一次配置 → 各窗口的焦点与关注点
    expect(port().sent).toEqual([
      { type: 'init', cacheFile: 'C:\\data\\cache\\index.db' },
      { type: 'configure', config },
      { type: 'windowFocus', ownerId: 5, focused: false },
      { type: 'interest', ownerId: 5, focus: 'file:///C:/a', visible: [], offscreen: [] }
    ])
    expect(client.available).toBe(true)
    // 旧进程迟到的消息不影响新进程的请求
    const again = client.list('file:///C:/a')
    ports[0]!.emit({ type: 'result', id: port().last('list').id, ok: true, value: listing('x') })
    port().emit({ type: 'result', id: port().last('list').id, ok: true, value: listing('y') })
    await expect(again).resolves.toEqual(listing('y'))
  })

  it('does not replay owners that were released', () => {
    const { client, port, ports } = setup()
    client.interest(5, { focus: null, visible: [], offscreen: [] })
    client.releaseOwner(5)
    ports[0]!.exit(1)
    expect(port().sent.map((m) => m.type)).toEqual(['init'])
  })

  it('stops restarting after 3 exits within 5 minutes and reports unavailable', async () => {
    let t = 0
    const { client, fork, ports, log } = setup({ now: () => t })
    ports[0]!.exit(1)
    t += 60_000
    ports[1]!.exit(1)
    t += 60_000
    ports[2]!.exit(1)

    expect(fork).toHaveBeenCalledTimes(3)
    expect(client.available).toBe(false)
    expect(log.error).toHaveBeenCalled()
    await expect(codeOf(client.list('file:///C:/a'))).resolves.toBe('INDEX_UNAVAILABLE')
    await expect(codeOf(client.cacheInfo())).resolves.toBe('INDEX_UNAVAILABLE')
    // 不再发送任何消息
    client.refresh(['file:///C:/a'])
    expect(ports[2]!.sent.some((m) => m.type === 'refresh')).toBe(false)
  })

  it('keeps restarting when exits are more than 5 minutes apart', () => {
    let t = 0
    const { client, fork, ports } = setup({ now: () => t })
    for (let i = 0; i < 5; i++) {
      t += 3 * 60_000
      ports[i]!.exit(1)
    }
    expect(fork).toHaveBeenCalledTimes(6)
    expect(client.available).toBe(true)
  })

  it('forwards changed and reachability events', () => {
    const { port, onChanged, onReachability } = setup()
    port().emit({ type: 'changed', uri: 'file:///C:/a' })
    port().emit({ type: 'reachability', share: '\\\\srv\\s', state: 'offline', since: 9 })
    expect(onChanged).toHaveBeenCalledWith('file:///C:/a')
    expect(onReachability).toHaveBeenCalledWith({ share: '\\\\srv\\s', state: 'offline', since: 9 })
  })

  it('keeps the set of offline shares from reachability events', () => {
    const { client, port } = setup()
    expect(client.offlineShares()).toEqual([])
    port().emit({ type: 'reachability', share: '\\\\srv\\s', state: 'offline', since: 9 })
    port().emit({ type: 'reachability', share: 'E:', state: 'offline', since: 10 })
    port().emit({ type: 'reachability', share: '\\\\srv\\s', state: 'online', since: 11 })
    expect(client.offlineShares()).toEqual([{ share: 'E:', since: 10 }])
  })

  it('reports offline shares as online when the scanner restarts (the new process re-detects)', () => {
    let t = 100
    const { client, port, ports, onReachability } = setup({ now: () => t })
    port().emit({ type: 'reachability', share: '\\\\srv\\s', state: 'offline', since: 9 })
    onReachability.mockClear()
    t = 500
    ports[0]!.exit(1)
    expect(onReachability.mock.calls).toEqual([
      [{ share: '\\\\srv\\s', state: 'online', since: 500 }]
    ])
    expect(client.offlineShares()).toEqual([])
  })

  it('reports offline shares as online when it gives up (degraded mode lists directly)', () => {
    let t = 0
    const { client, port, ports, onReachability } = setup({ now: () => t })
    ports[0]!.exit(1)
    t += 1000
    ports[1]!.exit(1)
    port().emit({ type: 'reachability', share: 'E:', state: 'offline', since: 1500 })
    onReachability.mockClear()
    t += 1000
    ports[2]!.exit(1)
    expect(client.available).toBe(false)
    expect(onReachability.mock.calls).toEqual([[{ share: 'E:', state: 'online', since: 2000 }]])
    expect(client.offlineShares()).toEqual([])
  })

  it('writes scanner logs to the logger and ignores invalid messages', () => {
    const { port, log, onChanged } = setup()
    port().emit({ type: 'log', level: 'error', message: 'boom' })
    port().emit({ type: 'ready' })
    port().emit({ type: 'changed' })
    expect(log.error).toHaveBeenCalledWith('[scanner] boom')
    expect(log.info).toHaveBeenCalledWith('[scanner] ready')
    expect(log.warn).toHaveBeenCalledTimes(1)
    expect(onChanged).not.toHaveBeenCalled()
  })

  it('rejects a request with FS_TIMEOUT when the scanner does not answer within 60 seconds', async () => {
    vi.useFakeTimers()
    try {
      const { client, port, log } = setup()
      const slow = client.list('file:///C:/a')
      const answered = client.cacheInfo()
      port().emit({
        type: 'result',
        id: port().last('cacheInfo').id,
        ok: true,
        value: { bytes: 1 }
      })
      await expect(answered).resolves.toEqual({ bytes: 1 })
      const code = codeOf(slow)
      await vi.advanceTimersByTimeAsync(59_999)
      let settled = false
      void code.then(() => (settled = true))
      await vi.advanceTimersByTimeAsync(0)
      expect(settled).toBe(false)
      await vi.advanceTimersByTimeAsync(1)
      // INDEX_UNAVAILABLE 会让 vfs.list 回退到直接枚举（同一共享上并发第二次枚举）：用单独的错误码
      await expect(code).resolves.toBe('FS_TIMEOUT')
      expect(log.warn).toHaveBeenCalled()
      // 迟到的结果被忽略；之后的请求照常
      port().emit({ type: 'result', id: port().last('list').id, ok: true, value: listing('late') })
      const next = client.list('file:///C:/b')
      port().emit({ type: 'result', id: port().last('list').id, ok: true, value: listing('b') })
      await expect(next).resolves.toEqual(listing('b'))
      // 已回应的请求不留下计时器
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('rejects the matching request with INDEX_UNAVAILABLE when its result fails validation', async () => {
    const { client, port, log } = setup()
    const bad = client.list('file:///C:/a')
    const other = client.list('file:///C:/b')
    const [ra, rb] = port().sent.filter((m) => m.type === 'list') as Array<
      Extract<MainToScanner, { type: 'list' }>
    >
    // ok: false 却没有合法的 error
    port().emit({ type: 'result', id: ra!.id, ok: false, error: { code: 'NOT_A_CODE' } })
    await expect(codeOf(bad)).resolves.toBe('INDEX_UNAVAILABLE')
    expect(log.warn).toHaveBeenCalledTimes(1)
    // 读不出 id 的无效消息只记日志，不影响其他请求
    port().emit({ type: 'result', id: 'x', ok: true })
    expect(log.warn).toHaveBeenCalledTimes(2)
    port().emit({ type: 'result', id: rb!.id, ok: true, value: listing('b') })
    await expect(other).resolves.toEqual(listing('b'))
  })

  it('dispose sends shutdown, rejects pending requests and does not restart', async () => {
    const { client, fork, port } = setup()
    const pending = client.list('file:///C:/a')
    await client.dispose()
    expect(port().last('shutdown')).toEqual({ type: 'shutdown' })
    await expect(codeOf(pending)).resolves.toBe('INDEX_UNAVAILABLE')
    expect(fork).toHaveBeenCalledTimes(1)
    expect(port().kill).not.toHaveBeenCalled()
    await expect(codeOf(client.list('file:///C:/a'))).resolves.toBe('INDEX_UNAVAILABLE')
  })

  it('dispose kills the process when it does not exit in time', async () => {
    vi.useFakeTimers()
    try {
      const { client, port } = setup()
      port().exitOnShutdown = false
      const done = client.dispose()
      await vi.advanceTimersByTimeAsync(5000)
      await done
      expect(port().kill).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })
})
