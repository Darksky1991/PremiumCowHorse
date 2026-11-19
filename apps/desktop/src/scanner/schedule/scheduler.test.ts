import { afterEach, describe, expect, it } from 'vitest'
import { AppError, type ErrorCode, type RootConfig, type ScanSettings } from '@pch/shared'
import { createLocator } from '../../main/vfs/location'
import { Cache, childUri } from '../cache/cache'
import type { Enumerator, RawEntry } from '../enum/types'
import { Scheduler } from './scheduler'

/** 注入的时钟与计时器：advance 依次触发到期的计时器，每次之后让微任务跑完（不做真实等待） */
class FakeClock {
  t = 1_000_000
  private seq = 0
  private readonly timers = new Map<number, { at: number; fn: () => void }>()

  now = (): number => this.t

  setTimer = ((fn: () => void, ms?: number) => {
    const id = ++this.seq
    this.timers.set(id, { at: this.t + Math.max(0, ms ?? 0), fn })
    return id
  }) as unknown as typeof setTimeout

  clearTimer = ((id?: number) => {
    if (id !== undefined) this.timers.delete(id)
  }) as unknown as typeof clearTimeout

  sleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      const id = this.setTimer(resolve, ms)
      signal?.addEventListener(
        'abort',
        () => {
          this.clearTimer(id)
          reject(signal.reason)
        },
        { once: true }
      )
    })
  }

  async advance(ms: number): Promise<void> {
    const end = this.t + ms
    await flush()
    for (;;) {
      let next: [number, { at: number; fn: () => void }] | undefined
      for (const e of this.timers) if (e[1].at <= end && (!next || e[1].at < next[1].at)) next = e
      if (!next) break
      this.timers.delete(next[0])
      this.t = Math.max(this.t, next[1].at)
      next[1].fn()
      await flush()
    }
    this.t = end
    await flush()
  }
}

const flush = async (): Promise<void> => {
  for (let i = 0; i < 3; i++) await new Promise<void>((r) => setImmediate(r))
}

/** 只在中止时失败（模拟会响应中止的卡住调用） */
const hang = (signal: AbortSignal): Promise<void> =>
  new Promise((_, reject) =>
    signal.addEventListener('abort', () => reject(signal.reason), { once: true })
  )

type Gate = (
  op: 'stat' | 'list',
  uri: string,
  signal: AbortSignal,
  onBatch: () => void
) => Promise<void> | undefined

interface FakeDir {
  mtime: number
  entries: RawEntry[]
}

/** 内存中的目录树；记录每次调用与每台主机的同时调用数 */
class FakeFs implements Enumerator {
  readonly native = true
  readonly dirs = new Map<string, FakeDir>()
  readonly calls: { op: 'stat' | 'list'; uri: string; at: number }[] = []
  readonly errors = new Map<string, ErrorCode>()
  readonly inFlight = new Map<string, number>()
  readonly maxInFlight = new Map<string, number>()
  maxTotal = 0
  gate: Gate | undefined
  private total = 0
  private readonly loc = createLocator(null)

  constructor(private readonly clock: FakeClock) {}

  location = (u: string): 'local' | 'network' => this.loc.location(u)
  shareKey = (u: string): string => this.loc.shareKey(u)
  hostKey = (u: string): string => this.loc.hostKey(u)

  mkdir(uri: string): string {
    if (!this.dirs.has(uri)) this.dirs.set(uri, { mtime: 1, entries: [] })
    return uri
  }

  addDir(parent: string, name: string): string {
    const u = this.mkdir(childUri(parent, name))
    this.dirs
      .get(parent)!
      .entries.push({ name, kind: 'directory', size: 0, mtime: 1, hidden: false })
    return u
  }

  /** 删除目录及其子树（父目录的条目保留，模拟父目录尚未重新枚举） */
  rmdir(uri: string): void {
    for (const u of [...this.dirs.keys()])
      if (u === uri || u.startsWith(`${uri}/`)) this.dirs.delete(u)
  }

  addFile(parent: string, name: string): void {
    const d = this.dirs.get(parent)!
    d.entries.push({ name, kind: 'file', size: 1, mtime: 1, hidden: false })
    d.mtime += 1
  }

  count(op: 'stat' | 'list', uri: string): number {
    return this.calls.filter((c) => c.op === op && c.uri === uri).length
  }

  statDir(uri: string, signal: AbortSignal): Promise<{ mtime: number }> {
    return this.op(
      'stat',
      uri,
      signal,
      () => {},
      (d) => ({ mtime: d.mtime })
    )
  }

  list(uri: string, opts: { signal: AbortSignal; onBatch: () => void }): Promise<RawEntry[]> {
    return this.op('list', uri, opts.signal, opts.onBatch, (d) => {
      opts.onBatch()
      return d.entries.map((e) => ({ ...e }))
    })
  }

  private async op<T>(
    op: 'stat' | 'list',
    uri: string,
    signal: AbortSignal,
    onBatch: () => void,
    done: (d: FakeDir) => T
  ): Promise<T> {
    this.calls.push({ op, uri, at: this.clock.now() })
    const host = this.hostKey(uri)
    this.track(host, 1)
    try {
      await this.gate?.(op, uri, signal, onBatch)
      const code = this.errors.get(uri)
      if (code) throw new AppError({ code, detail: uri })
      const d = this.dirs.get(uri)
      if (!d) throw new AppError({ code: 'FS_NOT_FOUND', detail: uri })
      return done(d)
    } finally {
      this.track(host, -1)
    }
  }

  private track(host: string, d: number): void {
    const n = (this.inFlight.get(host) ?? 0) + d
    this.inFlight.set(host, n)
    this.maxInFlight.set(host, Math.max(this.maxInFlight.get(host) ?? 0, n))
    this.total += d
    this.maxTotal = Math.max(this.maxTotal, this.total)
  }
}

const settings: ScanSettings = {
  intervalSec: { local: 5, network: 30 },
  backgroundIntervalMin: 10,
  timeoutSec: { local: 5, network: 10 },
  activeDepth: 3
}

const R = 'file:///C:/r'
const N = 'file://srv/share/n'
const SHARE = '\\\\srv\\share'

const root = (
  uri: string,
  level: RootConfig['level'] = 'passive',
  location: RootConfig['location'] = uri.startsWith('file:///') ? 'local' : 'network'
): RootConfig => ({ entryId: `e-${uri}`, workspaceId: 'w', uri, level, location })

const none = { focus: null, visible: [], offscreen: [] }

let disposers: (() => void)[] = []
afterEach(() => {
  for (const d of disposers) d()
  disposers = []
})

interface Harness {
  clock: FakeClock
  fs: FakeFs
  cache: Cache
  changed: string[]
  reach: [string, 'online' | 'offline', number][]
  logs: [string, string][]
  s: Scheduler
}

function setup(roots: RootConfig[], opts: { threadPoolSize?: number } = {}): Harness {
  const clock = new FakeClock()
  const fs = new FakeFs(clock)
  const cache = Cache.open(':memory:')
  const changed: string[] = []
  const reach: [string, 'online' | 'offline', number][] = []
  const logs: [string, string][] = []
  const s = new Scheduler({
    enumerator: fs,
    cache,
    events: {
      changed: (u) => changed.push(u),
      reachability: (share, state, since) => reach.push([share, state, since])
    },
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    threadPoolSize: opts.threadPoolSize ?? 8,
    log: (level, message) => logs.push([level, message])
  })
  for (const r of roots) fs.mkdir(r.uri)
  s.configure(
    roots,
    [],
    settings,
    roots.map((r) => r.uri)
  )
  disposers.push(() => {
    s.dispose()
    cache.close()
  })
  return { clock, fs, cache, changed, reach, logs, s }
}

describe('Scheduler', () => {
  it('skips enumeration when the directory mtime is unchanged and full is false', async () => {
    const { clock, fs, s } = setup([root(R)])
    fs.addFile(R, 'a.txt')
    s.setInterest(1, none)
    await clock.advance(0)
    expect(fs.count('list', R)).toBe(1) // 从未枚举 → 枚举
    await clock.advance(5000)
    await clock.advance(5000)
    expect(fs.count('stat', R)).toBe(3)
    expect(fs.count('list', R)).toBe(1)
  })

  it('always enumerates the focus directory', async () => {
    const { clock, fs, s } = setup([root(R)])
    const A = fs.addDir(R, 'a')
    s.setInterest(1, { ...none, focus: A })
    await clock.advance(0)
    expect(fs.count('list', A)).toBe(1)
    await clock.advance(5000)
    await clock.advance(5000)
    expect(fs.count('list', A)).toBe(3)
    expect(fs.count('list', R)).toBe(1)
  })

  it('emits changed only when the listing differs', async () => {
    const { clock, fs, s, changed } = setup([root(R)])
    fs.addFile(R, 'a.txt')
    s.setInterest(1, { ...none, focus: R })
    await clock.advance(0)
    expect(changed).toEqual([R])
    await clock.advance(5000)
    await clock.advance(5000)
    expect(fs.count('list', R)).toBe(3)
    expect(changed).toEqual([R])
    fs.addFile(R, 'b.txt')
    await clock.advance(5000)
    expect(changed).toEqual([R, R])
  })

  it('re-enumerates after an hour even when mtime is unchanged', async () => {
    const { clock, fs, s } = setup([root(R)])
    s.setInterest(1, none)
    await clock.advance(0)
    expect(fs.count('list', R)).toBe(1)
    await clock.advance(3_595_000)
    expect(fs.count('list', R)).toBe(1)
    await clock.advance(5000)
    expect(fs.count('list', R)).toBe(2)
  })

  it('pauses P1 while every window is unfocused and checks the focus on refocus', async () => {
    const { clock, fs, s } = setup([root(R)])
    const A = fs.addDir(R, 'a')
    const B = fs.addDir(R, 'b')
    s.setInterest(1, { ...none, focus: A })
    s.setInterest(2, { ...none, focus: B })
    await clock.advance(0)

    s.setWindowFocus(1, false)
    let n = fs.calls.length
    await clock.advance(5000)
    expect(fs.calls.length).toBeGreaterThan(n) // 窗口 2 仍有焦点

    s.setWindowFocus(2, false)
    n = fs.calls.length
    await clock.advance(60_000)
    expect(fs.calls.length).toBe(n)

    s.setWindowFocus(1, true)
    await clock.advance(0)
    expect(fs.calls[n]?.uri).toBe(A) // 关注点以 P0 最先检查
    expect(fs.calls.slice(n).some((c) => c.op === 'list' && c.uri === A)).toBe(true)

    // 没有任何 owner：等同于全部失焦
    s.releaseOwner(1)
    s.releaseOwner(2)
    n = fs.calls.length
    await clock.advance(60_000)
    expect(fs.calls.length).toBe(n)
  })

  it('limits network concurrency to one per host plus one for P0', async () => {
    const N1 = 'file://srv/share/a'
    const N2 = 'file://srv/share/b'
    const O = 'file://other/s/c'
    const { clock, fs, s } = setup([root(N1), root(N2), root(O)])
    const D = fs.mkdir('file://srv/share/d')
    const E = fs.mkdir('file://srv/share/e')
    fs.gate = (_op, _uri, signal) => clock.sleep(1000, signal)
    s.setInterest(1, none)
    await clock.advance(0)
    expect(fs.inFlight.get('srv')).toBe(1)
    expect(fs.inFlight.get('other')).toBe(1)

    const d = s.listNow(D)
    const e = s.listNow(E)
    await clock.advance(0)
    expect(fs.inFlight.get('srv')).toBe(2) // 后台 1 + P0 1，第二个 P0 等待

    await clock.advance(30_000)
    await expect(d).resolves.toMatchObject({ state: 'fresh' })
    await expect(e).resolves.toMatchObject({ state: 'fresh' })
    expect(fs.maxInFlight.get('srv')).toBe(2)
    expect(fs.maxInFlight.get('other')).toBe(1)
    expect(fs.count('list', N1) + fs.count('list', N2)).toBe(2)
  })

  it('never runs more native calls than the thread pool', async () => {
    const roots = [
      'file:///C:/a',
      'file:///D:/b',
      'file:///E:/c',
      'file://h1/s/x',
      'file://h2/s/y'
    ].map((u) => root(u))
    const { clock, fs, s } = setup(roots, { threadPoolSize: 3 })
    fs.gate = (_op, _uri, signal) => clock.sleep(1000, signal)
    s.setInterest(1, none)
    await clock.advance(20_000)
    expect(fs.maxTotal).toBe(3)
    for (const r of roots) expect(fs.count('list', r.uri)).toBe(1)
  })

  it('a stuck local volume does not block other volumes, network hosts or P0', async () => {
    const stuck = ['a', 'b', 'c', 'd'].map((x) => root(`file:///C:/${x}`))
    const E = 'file:///D:/e'
    const { clock, fs, s } = setup([...stuck, root(E), root(N)])
    const X = fs.mkdir('file:///D:/x')
    // C: 上的调用不返回、也不响应中止（故障盘）
    fs.gate = (_op, uri) =>
      uri.startsWith('file:///C:/') ? new Promise<void>(() => {}) : undefined
    s.setInterest(1, none)
    await clock.advance(1000)
    expect(fs.calls.filter((c) => c.uri.startsWith('file:///C:/'))).toHaveLength(1)
    expect(fs.count('list', E)).toBe(1)
    expect(fs.count('list', N)).toBe(1)
    await expect(s.listNow(X)).resolves.toMatchObject({ state: 'fresh' })
  })

  it('local P2 does not pause and volumes advance in parallel', async () => {
    const C = 'file:///C:/r'
    const D = 'file:///D:/s'
    const { clock, fs, cache } = setup([root(C, 'all'), root(D, 'all')]) // 没有 owner：只有 P2
    const dirs = [C, fs.addDir(C, 'a'), fs.addDir(C, 'b'), D, fs.addDir(D, 'a'), fs.addDir(D, 'b')]
    fs.gate = (_op, _uri, signal) => clock.sleep(1000, signal)
    const t0 = clock.now()
    await clock.advance(6000) // 每卷 3 个目录 × (stat 1s + list 1s)，两卷并行、无停顿
    for (const u of dirs) expect(cache.getDir(u)?.listedAt, u).not.toBeNull()
    const listAt = (prefix: string): number[] =>
      fs.calls.filter((c) => c.op === 'list' && c.uri.startsWith(prefix)).map((c) => c.at - t0)
    expect(listAt('file:///C:/')).toEqual([1000, 3000, 5000])
    expect(listAt('file:///D:/')).toEqual([1000, 3000, 5000])
  })

  it('a queued P0 waiter times out when the P0 lane never frees', async () => {
    const { clock, fs, s } = setup([root(N)])
    const A = fs.addDir(N, 'a')
    const B = fs.addDir(N, 'b')
    fs.gate = (op, uri, _signal, onBatch) => {
      if (op === 'list' && uri === A) {
        onBatch()
        return new Promise<void>(() => {}) // 中途卡住且不返回：P0 通道一直被占着
      }
      return undefined
    }
    s.setInterest(1, none)
    await clock.advance(0)
    const a = s.listNow(A).then(
      () => 'ok',
      (e: AppError) => e.code
    )
    await clock.advance(0)
    let b = 'pending'
    void s.listNow(B).then(
      () => (b = 'ok'),
      (e: AppError) => (b = e.code)
    )
    await clock.advance(9000)
    expect(b).toBe('pending')
    await clock.advance(1000)
    await expect(a).resolves.toBe('FS_TIMEOUT') // 中途超时：只算该目录
    expect(s.isOffline(N)).toBe(false)
    expect(b).toBe('FS_TIMEOUT') // 排队超过 timeoutSec
  })

  it('recovers when a cache call throws inside the scheduling loop', async () => {
    const { clock, fs, s, cache, logs } = setup([root(R, 'all')])
    const A = fs.addDir(R, 'a')
    const hot = cache.hot.bind(cache)
    const childDirs = cache.childDirs.bind(cache)
    let failHot = true
    let failChildren = true
    cache.hot = (k: number): string[] => {
      if (failHot) {
        failHot = false
        throw new Error('hot boom')
      }
      return hot(k)
    }
    // 只让调度循环（P2 取下一层）里的调用失败；applyListing 内部也调用 childDirs
    cache.childDirs = (u: string): string[] => {
      if (failChildren && new Error().stack?.includes('advanceLevel')) {
        failChildren = false
        throw new Error('childDirs boom')
      }
      return childDirs(u)
    }
    s.setInterest(1, none)
    await clock.advance(5000)
    expect(cache.getDir(R)?.listedAt).not.toBeNull()
    expect(cache.getDir(A)?.listedAt).not.toBeNull()
    expect(logs.filter(([level]) => level === 'error').map(([, m]) => m.split('\n')[0])).toEqual([
      expect.stringContaining('hot boom'),
      expect.stringContaining('childDirs boom')
    ])
  })

  it('a slow but progressing enumeration does not time out', async () => {
    const { clock, fs, s, cache, reach } = setup([root(R)])
    fs.addFile(R, 'a.txt')
    fs.gate = async (op, _uri, signal, onBatch) => {
      if (op !== 'list') return
      for (let i = 0; i < 4; i++) {
        await clock.sleep(4000, signal)
        onBatch()
      }
      await clock.sleep(4000, signal)
    }
    s.setInterest(1, none)
    await clock.advance(21_000)
    const dir = cache.getDir(R)
    expect(dir?.state).toBe('ok')
    expect(dir?.listedAt).not.toBeNull()
    expect(cache.getEntries(R).map((e) => e.name)).toEqual(['a.txt'])
    expect(reach).toEqual([])
  })

  it('a probe timeout marks the share offline and retries with 30s 60s 120s … 300s backoff', async () => {
    const { clock, fs, s, reach } = setup([root(N)])
    let first = true
    fs.gate = (op, _uri, signal) => {
      if (op === 'stat' && first) {
        first = false
        return hang(signal)
      }
      return undefined
    }
    fs.errors.set(N, 'FS_UNAVAILABLE')
    s.setInterest(1, none)
    const t0 = clock.now()
    await clock.advance(10_000)
    const offAt = t0 + 10_000
    expect(reach).toEqual([[SHARE, 'offline', offAt]])
    expect(s.isOffline(N)).toBe(true)

    await clock.advance(30_000 + 60_000 + 120_000 + 240_000 + 300_000 + 300_000)
    const starts = fs.calls.filter((c) => c.op === 'stat').map((c) => c.at)
    expect(starts[0]).toBe(t0)
    const probes = starts.slice(1)
    const gaps = probes.map((t, i) => t - (i === 0 ? offAt : probes[i - 1]!))
    expect(gaps).toEqual([30_000, 60_000, 120_000, 240_000, 300_000, 300_000])
    expect(fs.calls.every((c) => c.op === 'stat')).toBe(true) // 断开期间只探测
    expect(reach).toHaveLength(1)
  })

  it('a hung call keeps its host slot until it settles', async () => {
    const { clock, fs, s } = setup([root(N)])
    let release: () => void = () => {}
    let first = true
    fs.gate = (op) => {
      if (op === 'stat' && first) {
        first = false
        // 不响应中止：模拟 koffi 调用在系统返回前一直占着线程
        return new Promise<void>((r) => (release = r))
      }
      return undefined
    }
    s.setInterest(1, none)
    await clock.advance(10_000)
    expect(s.isOffline(N)).toBe(true)
    await clock.advance(60_000)
    expect(fs.calls).toHaveLength(1) // 到期的探测在等卡住的调用释放
    release()
    await clock.advance(0)
    expect(fs.calls[1]).toMatchObject({ op: 'stat', uri: N, at: clock.now() }) // 释放后探测立即开始
    expect(s.isOffline(N)).toBe(false)
  })

  it('a mid-enumeration timeout marks only that directory unreachable', async () => {
    const { clock, fs, s, cache, reach } = setup([root(N)])
    const A = fs.addDir(N, 'a')
    const B = fs.addDir(N, 'b')
    fs.gate = (op, uri, signal, onBatch) => {
      if (op === 'list' && uri === A) {
        onBatch()
        return hang(signal)
      }
      return undefined
    }
    s.setInterest(1, none)
    await clock.advance(0)
    s.setInterest(1, { ...none, focus: A })
    await clock.advance(10_000)
    expect(cache.getDir(A)).toMatchObject({ state: 'unreachable', errorCode: 'FS_TIMEOUT' })
    expect(s.isOffline(A)).toBe(false)
    expect(reach).toEqual([])
    await expect(s.listNow(B)).resolves.toMatchObject({ state: 'fresh', items: [] })
  })

  it('listNow returns cached items with state offline while the share is offline', async () => {
    const { clock, fs, s, cache } = setup([root(N)])
    fs.addFile(N, 'f.txt')
    s.setInterest(1, none)
    await clock.advance(0)
    const checkedAt = clock.now()
    await expect(s.listNow(N)).resolves.toMatchObject({ state: 'fresh', checkedAt })
    await clock.advance(3000)
    const cached = await s.listNow(N)
    expect(cached.state).toBe('cached')
    expect(cached.items).toEqual([
      { uri: childUri(N, 'f.txt'), name: 'f.txt', kind: 'file', size: 1, mtime: 1, hidden: false }
    ])

    await clock.advance(0)
    const lastChecked = cache.getDir(N)!.checkedAt // 上面的 listNow 排了一次 P0
    fs.gate = (op, _uri, signal) => (op === 'stat' ? hang(signal) : undefined)
    await clock.advance(30_000 + 10_000)
    expect(s.isOffline(N)).toBe(true)
    const n = fs.calls.length
    const l = await s.listNow(N)
    expect(l.state).toBe('offline')
    expect(l.items.map((i) => i.name)).toEqual(['f.txt'])
    expect(l.checkedAt).toBe(lastChecked)
    await expect(s.listNow(childUri(N, 'nothing'))).rejects.toMatchObject({
      code: 'FS_UNAVAILABLE'
    })
    await clock.advance(0)
    expect(fs.calls.length).toBe(n) // 不发起访问
  })

  it('refresh bypasses the backoff once', async () => {
    const { clock, fs, s, reach } = setup([root(N)])
    let first = true
    fs.gate = (op, _uri, signal) => {
      if (op === 'stat' && first) {
        first = false
        return hang(signal)
      }
      return undefined
    }
    fs.errors.set(N, 'FS_UNAVAILABLE')
    s.setInterest(1, none)
    await clock.advance(10_000)
    const offAt = clock.now()
    expect(s.isOffline(N)).toBe(true)

    await clock.advance(5000)
    s.refresh([N])
    await clock.advance(0)
    expect(fs.calls.filter((c) => c.op === 'stat').map((c) => c.at - offAt)).toEqual([
      -10_000, 5000
    ])
    expect(s.isOffline(N)).toBe(true)

    // 退避的时刻表不变：下一次探测仍在断开后 30 秒
    await clock.advance(25_000)
    expect(fs.calls.filter((c) => c.op === 'stat').map((c) => c.at - offAt)).toEqual([
      -10_000, 5000, 30_000
    ])

    fs.errors.delete(N)
    await clock.advance(5000)
    s.refresh([N])
    await clock.advance(0)
    expect(s.isOffline(N)).toBe(false)
    expect(reach.map((r) => r[1])).toEqual(['offline', 'online'])
  })

  it('deduplicates P0 for the same directory within 2 seconds', async () => {
    const { clock, fs, s } = setup([root(R)])
    s.setInterest(1, none)
    await clock.advance(10_000)
    const n = fs.count('stat', R)
    await s.listNow(R)
    await clock.advance(1000)
    await s.listNow(R)
    s.refresh([R])
    await clock.advance(0)
    expect(fs.count('stat', R)).toBe(n + 1)
    await clock.advance(1500)
    s.refresh([R])
    await clock.advance(0)
    expect(fs.count('stat', R)).toBe(n + 2)
  })

  it('not-found removes the subtree and notifies the parent', async () => {
    const { clock, fs, s, cache, changed } = setup([root(R)])
    const A = fs.addDir(R, 'a')
    const AB = fs.addDir(A, 'b')
    s.setInterest(1, { ...none, focus: A })
    await clock.advance(0)
    expect(cache.getDir(AB)).toBeDefined()

    changed.length = 0
    fs.rmdir(A)
    await clock.advance(5000)
    expect(cache.getDir(A)).toBeUndefined()
    expect(cache.getDir(AB)).toBeUndefined()
    expect(changed).toEqual([R])

    // 根目录本身不在了：删除缓存并通知根；之后 listNow 以 FS_NOT_FOUND 拒绝
    changed.length = 0
    fs.rmdir(R)
    await clock.advance(5000)
    expect(cache.getDir(R)).toBeUndefined()
    expect(changed).toEqual([R])
    await expect(s.listNow(R)).rejects.toMatchObject({ code: 'FS_NOT_FOUND' })
    await clock.advance(5000)
    expect(changed).toEqual([R]) // 已没有缓存：不重复通知
  })

  it('permission denied marks the directory and retries at the background interval', async () => {
    const { clock, fs, s, cache } = setup([root(R)])
    const A = fs.addDir(R, 'a')
    fs.errors.set(A, 'FS_PERMISSION_DENIED')
    s.setInterest(1, { ...none, focus: A })
    await clock.advance(0)
    expect(cache.getDir(A)).toMatchObject({ state: 'denied', errorCode: 'FS_PERMISSION_DENIED' })
    const n = fs.count('stat', A)
    await clock.advance(60_000)
    expect(fs.count('stat', A)).toBe(n)
    await clock.advance(10 * 60_000)
    expect(fs.count('stat', A)).toBe(n + 1)
  })

  it('an unknown error marks only that directory unreachable, not the whole share', async () => {
    const { clock, fs, s, cache, reach } = setup([root(N)])
    const A = fs.addDir(N, 'a')
    const B = fs.addDir(N, 'b')
    s.setInterest(1, none)
    await clock.advance(0)
    fs.errors.set(A, 'UNKNOWN')
    s.setInterest(1, { ...none, focus: A })
    await clock.advance(0)
    expect(cache.getDir(A)).toMatchObject({ state: 'unreachable', errorCode: 'UNKNOWN' })
    expect(s.isOffline(N)).toBe(false)
    expect(reach).toEqual([])
    await expect(s.listNow(B)).resolves.toMatchObject({ state: 'fresh' })
  })

  it('rejects invalid URIs without disturbing the schedule', async () => {
    const { clock, fs, s } = setup([root(R)])
    await expect(s.listNow('not a uri')).rejects.toMatchObject({ code: 'FS_INVALID_URI' })
    await expect(s.listNow('https://x/y')).rejects.toMatchObject({
      code: 'FS_UNSUPPORTED_SCHEME'
    })
    s.refresh(['not a uri'])
    s.setInterest(1, { focus: 'not a uri', visible: ['::'], offscreen: [] })
    expect(s.isOffline('not a uri')).toBe(false)
    await clock.advance(0)
    expect(fs.count('list', R)).toBe(1)
  })

  it('all level keeps the queue bounded by the frontier', async () => {
    // 网络根：同时验证同一主机两次 P2 之间的停顿
    const { clock, fs, s, cache } = setup([root(N, 'all')])
    // 3 层、每层 50 个目录：第 2 层都在第 1 层的第一个目录下，第 3 层都在第 2 层的第一个目录下
    const all: string[] = [N]
    let parent = N
    for (let level = 1; level <= 3; level++) {
      const made: string[] = []
      for (let i = 0; i < 50; i++) made.push(fs.addDir(parent, `d${level}-${i}`))
      all.push(...made)
      parent = made[0]!
    }
    // 没有 owner：P1 暂停，只有 P2 在跑
    let maxQueued = 0
    for (let i = 0; i < 400; i++) {
      await clock.advance(100)
      maxQueued = Math.max(maxQueued, s.queueStats().queued)
    }
    for (const u of all) expect(cache.getDir(u)?.listedAt, u).not.toBeNull()
    expect(maxQueued).toBeLessThanOrEqual(50 + 5)
    expect(maxQueued).toBeGreaterThan(0)

    // 同一主机两次 P2 之间至少停顿 200ms
    const starts = fs.calls.filter((c) => c.op === 'stat').map((c) => c.at)
    for (let i = 1; i < starts.length; i++) {
      expect(starts[i]! - starts[i - 1]!).toBeGreaterThanOrEqual(200)
    }

    // 下一轮在 backgroundIntervalMin 之后，先比较修改时间（不枚举）
    const lists = fs.calls.filter((c) => c.op === 'list').length
    await clock.advance(10 * 60_000)
    const statsAfter = fs.calls.filter((c) => c.op === 'stat').length
    expect(statsAfter).toBeGreaterThan(starts.length)
    expect(fs.calls.filter((c) => c.op === 'list').length).toBe(lists)
  })
})
