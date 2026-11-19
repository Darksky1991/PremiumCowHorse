import { afterEach, describe, expect, it } from 'vitest'
import { AppError, type ErrorCode, type RootConfig, type ScanSettings } from '@pch/shared'
import { createLocator } from '../../main/vfs/location'
import { Cache, childUri, type Scope } from '../cache/cache'
import type { Enumerator, RawEntry } from '../enum/types'
import { BATCH_SIZE, OLDEST_BATCH_SIZE } from './background-queue'
import { Scheduler } from './scheduler'
import { TIER_LIMIT } from './scope'

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

  /** 每次检查都从 statDir 开始：按顺序返回被检查的目录 */
  checked(): string[] {
    return this.calls.filter((c) => c.op === 'stat').map((c) => c.uri)
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

/** 设计 8.2 的默认值 */
const settings: ScanSettings = {
  interval: {
    focus: { local: 5, network: 10 },
    near: { local: 30, network: 60 },
    far: { local: 120, network: 300 }
  },
  backgroundGapMs: { local: 500, network: 2000 },
  timeoutSec: { local: 5, network: 10 },
  activeDepth: 3
}

const R = 'file:///C:/r'
const N = 'file://srv/share/n'
const SHARE = '\\\\srv\\share'

const root = (
  uri: string,
  strategy: RootConfig['strategy'] = 'passive',
  location: RootConfig['location'] = uri.startsWith('file:///') ? 'local' : 'network'
): RootConfig => ({ entryId: `e-${uri}`, workspaceId: 'w', uri, strategy, location })

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

function setup(
  roots: RootConfig[],
  opts: { threadPoolSize?: number; settings?: ScanSettings; indexTargets?: string[] } = {}
): Harness {
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
    opts.indexTargets ?? [],
    opts.settings ?? settings,
    roots.map((r) => r.uri)
  )
  disposers.push(() => {
    s.dispose()
    cache.close()
  })
  return { clock, fs, cache, changed, reach, logs, s }
}

/** 测试前预先写入缓存（fs 中的当前列表） */
function prelist(h: Harness, uri: string, at: number): void {
  const d = h.fs.dirs.get(uri)!
  h.cache.applyListing(uri, d.mtime, d.entries, at)
}

describe('Scheduler: periodic checks', () => {
  it('focus is fully enumerated every focus interval', async () => {
    const { clock, fs, s } = setup([root(R), root(N)])
    const A = fs.addDir(R, 'a')
    const B = fs.addDir(N, 'b')
    s.setInterest(1, { ...none, focus: A })
    s.setInterest(2, { ...none, focus: B })
    await clock.advance(0)
    expect(fs.count('list', A)).toBe(1)
    expect(fs.count('list', B)).toBe(1)
    // 修改时间不变也每次完整读取：本地 5 秒、网络 10 秒
    await clock.advance(10_000)
    expect(fs.count('list', A)).toBe(3)
    expect(fs.count('list', B)).toBe(2)
  })

  it('near and far use mtime and their own intervals', async () => {
    const { clock, fs, s } = setup([root(R, 'default')])
    const G = fs.addDir(R, 'g')
    const P = fs.addDir(G, 'p')
    const F = fs.addDir(P, 'f')
    fs.addDir(F, 'c') // 子目录：同时在热点（关注点）的后台范围内，不用于计数
    const S = fs.addDir(P, 's')
    const U = fs.addDir(G, 'u')
    const V = fs.addDir(R, 'v')
    const O = fs.addDir(R, 'o')
    s.setInterest(1, { focus: F, visible: [V], offscreen: [O] })
    // 近 / 远层的确认之间至少间隔 PERIODIC_GAP_MS（本地 50ms）：这些目录在 1 秒内依次确认
    await clock.advance(1000)
    const near = [P, S, V]
    const far = [G, U, R, O]
    const stats = (list: string[]): number[] => list.map((u) => fs.count('stat', u))
    for (const u of [...near, ...far]) expect(fs.count('stat', u), u).toBe(1)

    await clock.advance(30_000)
    expect(stats(near)).toEqual([2, 2, 2])
    expect(stats(far)).toEqual([1, 1, 1, 1])
    await clock.advance(90_000)
    expect(stats(near)).toEqual([5, 5, 5])
    expect(stats(far)).toEqual([2, 2, 2, 2])
    // 修改时间不变：只有第一次（没有列表）完整读取
    for (const u of [...near, ...far]) expect(fs.count('list', u), u).toBe(1)
    // 关注点每 5 秒完整读取
    expect(fs.count('list', F)).toBe(1 + 120_000 / 5000)
  })

  it('passive only checks the focus', async () => {
    const { clock, fs, s } = setup([root(R)])
    const A = fs.addDir(R, 'a')
    fs.addDir(A, 'c')
    const V = fs.addDir(R, 'v')
    s.setInterest(1, { focus: A, visible: [V], offscreen: [R] })
    await clock.advance(200_000)
    expect(new Set(fs.calls.map((c) => c.uri))).toEqual(new Set([A]))
    expect(fs.count('list', A)).toBe(1 + 200_000 / 5000)
  })

  it('periodic checks pause while every window is unfocused and the focus is checked on refocus', async () => {
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

  it('no directory is re-enumerated only because time has passed', async () => {
    // 后台的休息时间拉长，只为让用例跑得快
    const slow = { ...settings, backgroundGapMs: { local: 60_000, network: 60_000 } }
    const { clock, fs, s } = setup([root(R, 'all')], { settings: slow })
    const A = fs.addDir(R, 'a')
    const B = fs.addDir(R, 'b')
    const X = fs.addDir(A, 'x')
    s.setInterest(1, { focus: null, visible: [A], offscreen: [B] })
    await clock.advance(3 * 3_600_000)
    for (const u of [R, A, B, X]) {
      expect(fs.count('list', u), u).toBe(1)
      expect(fs.count('stat', u), u).toBeGreaterThan(10)
    }
  })

  it('permission denied marks the directory and retries at the far interval', async () => {
    const { clock, fs, s, cache } = setup([root(R)])
    const A = fs.addDir(R, 'a')
    fs.errors.set(A, 'FS_PERMISSION_DENIED')
    s.setInterest(1, { ...none, focus: A })
    await clock.advance(0)
    expect(cache.getDir(A)).toMatchObject({ state: 'denied', errorCode: 'FS_PERMISSION_DENIED' })
    const n = fs.count('stat', A)
    await clock.advance(60_000)
    expect(fs.count('stat', A)).toBe(n)
    await clock.advance(60_000)
    expect(fs.count('stat', A)).toBe(n + 1)
  })
})

describe('Scheduler: background queue', () => {
  it('background prefers unlisted index targets, then unlisted scope, then hot, then oldest', async () => {
    const IDX = `${R}/idx`
    const h = setup([root(R, 'default')], { indexTargets: [IDX] })
    const { clock, fs, cache } = h
    fs.addDir(R, 'idx')
    const HOT = fs.addDir(R, 'hot')
    const OTHER = fs.addDir(R, 'other')
    const I1 = fs.addDir(IDX, 'i1')
    const I2 = fs.addDir(IDX, 'i2')
    const H1 = fs.addDir(HOT, 'h1')
    const H2 = fs.addDir(HOT, 'h2')
    // 缓存：R、idx、hot 已读过（idx 比 hot 更久没确认），子目录都还没有信息；hot 是热点
    prelist(h, R, 100)
    prelist(h, IDX, 200)
    prelist(h, HOT, 300)
    cache.visit(HOT, 300)
    // 没有窗口：定期确认暂停，只有后台队列
    await clock.advance(10_000)
    const order = fs.checked()
    // ① 建立索引中没有信息的 → ② 范围内没有信息的（热点的子目录）
    expect(order.slice(0, 4)).toEqual([I1, I2, H1, H2])
    // ③ 热点中最久没确认的（hot）先于 ④ 其余范围内最久没确认的（idx，确认时刻更早）
    const rest = order.slice(4)
    expect(rest[0]).toBe(HOT)
    expect(rest).toContain(IDX)
    // 不在任何后台范围内的目录不进入队列
    expect(fs.count('stat', OTHER)).toBe(0)
    expect(fs.count('stat', R)).toBe(0)
  })

  it('background runs one directory at a time per location group and rests backgroundGapMs between', async () => {
    const C = 'file:///C:/r'
    const D = 'file:///D:/s'
    const { clock, fs } = setup([root(C, 'all'), root(D, 'all'), root(N, 'all')])
    for (const r of [C, D, N]) {
      fs.addDir(r, 'a')
      fs.addDir(r, 'b')
    }
    fs.gate = (_op, _uri, signal) => clock.sleep(1000, signal)
    const t0 = clock.now()
    await clock.advance(12_000) // 没有窗口：只有后台队列
    const listAt = (prefix: string): number[] =>
      fs.calls.filter((c) => c.op === 'list' && c.uri.startsWith(prefix)).map((c) => c.at - t0)
    // 每个目录 statDir 1 秒 + 读取 1 秒，完成后休息：本地 0.5 秒（各卷并行），网络 2 秒
    expect(listAt('file:///C:/')).toEqual([1000, 3500, 6000])
    expect(listAt('file:///D:/')).toEqual([1000, 3500, 6000])
    expect(listAt('file://srv/')).toEqual([1000, 5000, 9000])
    expect(fs.maxInFlight.get('srv')).toBe(1)
  })

  it('background keeps going while the user is busy, with doubled gaps', async () => {
    const P = 'file:///D:/p'
    const { clock, fs, s } = setup([root(R, 'all'), root(P)])
    for (let i = 0; i < 40; i++) fs.addDir(R, `d${String(i).padStart(2, '0')}`)
    const X = fs.addDir(P, 'x')
    const Y = fs.addDir(P, 'y')
    const t0 = clock.now()
    // 用户一直在操作：每秒改变一次可见范围（消极的根，本身不产生检查）
    s.setInterest(1, { ...none, visible: [X] })
    for (let i = 1; i <= 20; i++) {
      await clock.advance(1000)
      s.setInterest(1, { ...none, visible: [i % 2 === 0 ? X : Y] })
    }
    await clock.advance(20_000)
    // 0 秒时根目录由定期确认（远层）读取，之后 C: 上只有后台队列
    const starts = fs.calls
      .filter((c) => c.op === 'stat' && (c.uri === R || c.uri.startsWith(`${R}/`)))
      .map((c) => c.at - t0)
    const gaps = (from: number, to: number): number[] => {
      const t = starts.filter((x) => x >= from && x <= to)
      return t.slice(1).map((x, i) => x - t[i]!)
    }
    // 操作期间（最后一次变化在 20 秒）：不停，只是休息时间加倍（0.5 → 1 秒）
    expect(starts.filter((x) => x > 0 && x <= 20_000)).toHaveLength(20)
    expect(new Set(gaps(1000, 20_000))).toEqual(new Set([1000]))
    // 10 秒没有变化后恢复为 0.5 秒
    expect(new Set(gaps(31_000, 40_000))).toEqual(new Set([500]))
  })

  it('a failing directory is not retried before others', async () => {
    // 远层间隔取下限 2 秒：后台队列每 2 秒后就可以重新确认同一目录，才能观察到多轮
    const short = {
      ...settings,
      interval: { ...settings.interval, far: { local: 2, network: 10 } }
    }
    const { clock, fs } = setup([root(R, 'all')], { settings: short })
    const A = fs.addDir(R, 'a')
    const others = [fs.addDir(R, 'b'), fs.addDir(R, 'c'), fs.addDir(R, 'd')]
    fs.errors.set(A, 'FS_PERMISSION_DENIED')
    await clock.advance(30_000)
    const order = fs.checked()
    const at = order.flatMap((u, i) => (u === A ? [i] : []))
    expect(at.length).toBeGreaterThanOrEqual(3)
    // 失败的时刻记为确认时刻：两次重试之间其他目录都轮到一次
    for (let k = 1; k < at.length; k++) {
      const between = new Set(order.slice(at[k - 1]! + 1, at[k]))
      for (const o of others) expect(between.has(o), `${k}: ${o}`).toBe(true)
    }
  })

  it('background does not re-check a directory within the far interval in a small range', async () => {
    const h = setup([root(R, 'default')])
    const { clock, fs, cache } = h
    const hot = ['h1', 'h2', 'h3'].map((n) => fs.addDir(R, n))
    prelist(h, R, clock.now())
    for (const u of hot) {
      prelist(h, u, clock.now())
      cache.visit(u, clock.now())
    }
    const t0 = clock.now()
    await clock.advance(10 * 60_000) // 没有窗口：只有后台队列
    for (const u of hot) {
      const at = fs.calls.filter((c) => c.op === 'stat' && c.uri === u).map((c) => c.at - t0)
      expect(at.length, u).toBeGreaterThanOrEqual(4)
      // 远层（本地 120 秒）之内不重复确认
      for (let i = 1; i < at.length; i++)
        expect(at[i]! - at[i - 1]!, u).toBeGreaterThanOrEqual(120_000)
      expect(at[0]!, u).toBeGreaterThanOrEqual(120_000)
    }
  })

  it('background sleeps without querying the cache until a directory is due again', async () => {
    const h = setup([root(R, 'default')])
    const { clock, fs, cache } = h
    const H = fs.addDir(R, 'h')
    prelist(h, H, clock.now())
    cache.visit(H, clock.now())
    let queries = 0
    const oldest = cache.oldestChecked.bind(cache)
    const unlisted = cache.nextUnlisted.bind(cache)
    cache.oldestChecked = (sc, limit, ex): string[] => {
      queries += 1
      return oldest(sc, limit, ex)
    }
    cache.nextUnlisted = (sc, limit, ex): string[] => {
      queries += 1
      return unlisted(sc, limit, ex)
    }
    await clock.advance(0)
    const n = queries
    expect(n).toBeGreaterThan(0) // 取过一次：唯一的目录刚确认过，不可选
    await clock.advance(119_000)
    expect(queries).toBe(n) // 休眠到 120 秒，期间不查询
    expect(fs.count('stat', H)).toBe(0)
    await clock.advance(1000)
    expect(queries).toBeGreaterThan(n)
    expect(fs.count('stat', H)).toBe(1)
  })

  it('a group does not sleep forever when its only directory was being checked by P0', async () => {
    const h = setup([root(R, 'default')])
    const { clock, fs, cache, s } = h
    const H = fs.addDir(R, 'h')
    prelist(h, H, clock.now() - 3_600_000) // 很久以前确认过：后台随时可以确认
    cache.visit(H, clock.now())
    let slow = true
    fs.gate = (op, uri, signal) => {
      if (op === 'stat' && uri === H && slow) {
        slow = false
        return clock.sleep(1000, signal)
      }
      return undefined
    }
    // P0 正在检查 H 时后台队列取候选：H 被排除，查询结果为空
    s.refresh([H])
    await clock.advance(10 * 60_000)
    // P0 之后（修改时间与列表都没变）后台队列仍按远层间隔（120 秒）继续确认
    expect(fs.count('stat', H)).toBeGreaterThanOrEqual(5)
  })

  it('a missing index target is read once, not again on every scope change', async () => {
    const IDX = `${R}/gone`
    const { clock, fs, s } = setup([root(R, 'active')], { indexTargets: [IDX] })
    const A = fs.addDir(R, 'a')
    const B = fs.addDir(R, 'b')
    // 关注点来回移动：热点与「积极」的范围随之变化
    for (let i = 0; i < 6; i++) {
      s.setInterest(1, { ...none, focus: i % 2 === 0 ? A : B })
      await clock.advance(3000)
    }
    expect(fs.count('stat', IDX)).toBe(1)

    // 配置（建立索引目标）变化：重新尝试一次
    s.configure([root(R, 'active')], [IDX, A], settings, [R])
    await clock.advance(3000)
    expect(fs.count('stat', IDX)).toBe(2)

    // 目录被建立后经 F5 确认存在：之后照常进入后台队列
    fs.addDir(R, 'gone')
    s.refresh([IDX])
    await clock.advance(3000)
    expect(fs.count('list', IDX)).toBe(1)
  })

  it('candidates that left the scope are not checked', async () => {
    const h = setup([root(R, 'active')], {
      settings: { ...settings, activeDepth: 1 }
    })
    const { clock, fs, s } = h
    const A = fs.addDir(R, 'a')
    const X = fs.addDir(A, 'x')
    const S = fs.addDir(A, 's')
    const cousins = Array.from({ length: 20 }, (_, i) => fs.addDir(S, `k${i}`))
    const B = fs.addDir(R, 'b')
    const Y = fs.addDir(B, 'y')
    for (const u of [R, A, S, B]) prelist(h, u, clock.now())
    // 关注点 a/x、N=1：后台范围为 a 之下 2 层，含 a/s 的子目录（不在定期确认的分层中）
    s.setInterest(1, { ...none, focus: X })
    await clock.advance(5000)
    const checked = (): number => cousins.filter((u) => fs.count('stat', u) > 0).length
    expect(checked()).toBeGreaterThan(0)
    expect(checked()).toBeLessThan(cousins.length) // 还有候选留在批次中
    // 关注点移到 b/y：范围变为 b 之下，旧批次的候选不再确认
    s.setInterest(1, { ...none, focus: Y })
    const before = checked()
    await clock.advance(60_000)
    expect(checked()).toBe(before)
  })

  it('a share going offline drops the candidates and coming back resumes the queue', async () => {
    const { clock, fs, s } = setup([root(N, 'all')])
    const dirs = Array.from({ length: 10 }, (_, i) => fs.addDir(N, `d${i}`))
    let hung = false
    fs.gate = (op, uri, signal) => {
      // d3 的第一次 statDir 卡住：探测阶段超时 → 共享断开
      if (op === 'stat' && uri === dirs[3] && !hung) {
        hung = true
        return hang(signal)
      }
      return undefined
    }
    await clock.advance(20_000)
    expect(s.isOffline(N)).toBe(true)
    expect(s.queueStats().queued).toBe(0) // 候选已丢弃，断开期间不再取
    const n = fs.calls.length
    await clock.advance(25_000)
    expect(fs.calls.slice(n).every((c) => c.uri === dirs[3])).toBe(true) // 只有探测
    // 第一次探测（断开后 30 秒）成功 → 恢复，队列重新取候选，剩下的目录照常读完
    await clock.advance(60_000)
    expect(s.isOffline(N)).toBe(false)
    for (const u of dirs) expect(fs.count('list', u), u).toBe(1)
  })

  it('background selection does not materialize the whole tree', async () => {
    const h = setup([root(R, 'all')])
    const { clock, fs, cache, s } = h
    const n = 50_000
    const entries = fs.dirs.get(R)!.entries
    for (let i = 0; i < n; i++) {
      const name = `d${i}`
      fs.mkdir(childUri(R, name))
      entries.push({ name, kind: 'directory', size: 0, mtime: 1, hidden: false })
    }
    prelist(h, R, 100) // 5 万个没有信息的目录
    const limits: number[] = []
    const spy =
      (fn: (scopes: Scope[], limit: number, exclude?: Set<string>) => string[]) =>
      (scopes: Scope[], limit: number, exclude?: Set<string>): string[] => {
        limits.push(limit)
        return fn.call(cache, scopes, limit, exclude)
      }
    cache.nextUnlisted = spy(cache.nextUnlisted)
    cache.oldestChecked = spy(cache.oldestChecked)
    let maxQueued = 0
    for (let i = 0; i < 60; i++) {
      await clock.advance(1000)
      maxQueued = Math.max(maxQueued, s.queueStats().queued)
    }
    expect(fs.checked().length).toBeGreaterThanOrEqual(100) // 照常前进
    expect(limits.length).toBeGreaterThan(0)
    expect(Math.max(...limits)).toBeLessThanOrEqual(OLDEST_BATCH_SIZE)
    // 内存中的候选数是常数（没有信息的每类 BATCH_SIZE 个；最久没确认的另有上限），与目录总数无关
    expect(maxQueued).toBeGreaterThan(0)
    expect(maxQueued).toBeLessThanOrEqual(BATCH_SIZE + OLDEST_BATCH_SIZE + 1)
  })
})

describe('Scheduler: P0, concurrency and errors', () => {
  it('limits network concurrency to one per host plus one for P0', async () => {
    const N1 = 'file://srv/share/a'
    const N2 = 'file://srv/share/b'
    const O = 'file://other/s/c'
    const { clock, fs, s } = setup([root(N1, 'default'), root(N2, 'default'), root(O, 'default')])
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
    ].map((u) => root(u, 'default'))
    const { clock, fs, s } = setup(roots, { threadPoolSize: 3 })
    fs.gate = (_op, _uri, signal) => clock.sleep(1000, signal)
    s.setInterest(1, none)
    await clock.advance(20_000)
    expect(fs.maxTotal).toBe(3)
    for (const r of roots) expect(fs.count('list', r.uri)).toBe(1)
  })

  it('a stuck local volume does not block other volumes, network hosts or P0', async () => {
    const stuck = ['a', 'b', 'c', 'd'].map((x) => root(`file:///C:/${x}`, 'all'))
    const E = 'file:///D:/e'
    const { clock, fs, s } = setup([...stuck, root(E, 'default'), root(N, 'default')])
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
    const nextUnlisted = cache.nextUnlisted.bind(cache)
    let failHot = true
    let failQueue = true
    cache.hot = (k: number): string[] => {
      if (failHot) {
        failHot = false
        throw new Error('hot boom')
      }
      return hot(k)
    }
    cache.nextUnlisted = (scopes, limit, exclude): string[] => {
      if (failQueue) {
        failQueue = false
        throw new Error('queue boom')
      }
      return nextUnlisted(scopes, limit, exclude)
    }
    s.setInterest(1, none)
    await clock.advance(5000)
    expect(cache.getDir(R)?.listedAt).not.toBeNull()
    expect(cache.getDir(A)?.listedAt).not.toBeNull()
    expect(logs.filter(([level]) => level === 'error').map(([, m]) => m.split('\n')[0])).toEqual([
      expect.stringContaining('hot boom'),
      expect.stringContaining('queue boom')
    ])
  })

  it('a slow but progressing enumeration does not time out', async () => {
    const { clock, fs, s, cache, reach } = setup([root(R, 'default')])
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
    const { clock, fs, s, reach } = setup([root(N, 'default')])
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
    const { clock, fs, s } = setup([root(N, 'default')])
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
    s.setInterest(1, { ...none, focus: N })
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
    const { clock, fs, s, reach } = setup([root(N, 'default')])
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
    const { clock, fs, s } = setup([root(R, 'default')])
    s.setInterest(1, none)
    await clock.advance(10_000)
    await clock.advance(3000) // 上次检查已超过 2 秒：listNow 返回 cached 并排 P0
    const n = fs.count('stat', R)
    await expect(s.listNow(R)).resolves.toMatchObject({ state: 'cached' })
    await clock.advance(0)
    expect(fs.count('stat', R)).toBe(n + 1)
    await clock.advance(1000)
    s.refresh([R])
    await clock.advance(0)
    expect(fs.count('stat', R)).toBe(n + 1)
    await clock.advance(1500)
    s.refresh([R])
    await clock.advance(0)
    expect(fs.count('stat', R)).toBe(n + 2)
  })

  it('a listNow right after a periodic check found a change does not enumerate again', async () => {
    const { clock, fs, s, changed } = setup([root(R, 'default')])
    s.setInterest(1, none)
    await clock.advance(0)
    fs.addFile(R, 'b.txt')
    changed.length = 0
    await clock.advance(120_000) // 远层（根）：修改时间变化 → 读取 → changed
    expect(changed).toEqual([R])
    const lists = fs.count('list', R)
    const stats = fs.count('stat', R)
    // 渲染端收到 vfs.changed 后重新列出：刚检查过（fresh），不再排 P0
    await expect(s.listNow(R)).resolves.toMatchObject({ state: 'fresh' })
    await clock.advance(1500)
    await expect(s.listNow(R)).resolves.toMatchObject({ state: 'fresh' })
    await clock.advance(0)
    expect(fs.count('list', R)).toBe(lists)
    expect(fs.count('stat', R)).toBe(stats)
  })

  it('not-found removes the subtree and notifies the parent', async () => {
    const { clock, fs, s, cache, changed } = setup([root(R, 'default')])
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

    // 根目录本身不在了（关注点的父目录：近层 30 秒）：删除缓存并通知根；之后 listNow 以 FS_NOT_FOUND 拒绝
    changed.length = 0
    fs.rmdir(R)
    await clock.advance(30_000)
    expect(cache.getDir(R)).toBeUndefined()
    expect(changed).toEqual([R])
    await expect(s.listNow(R)).rejects.toMatchObject({ code: 'FS_NOT_FOUND' })
    await clock.advance(30_000)
    expect(changed).toEqual([R]) // 已没有缓存：不重复通知
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
    const { clock, fs, s } = setup([root(R, 'default')])
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
})

describe('Scheduler: many sibling directories', () => {
  const pad = (i: number): string => String(i).padStart(4, '0')

  it('a focus with 5,000 siblings on a network host stays within 5 checks per second and the background keeps its pace', async () => {
    const h = setup([root(N, 'all')])
    const { clock, fs, s } = h
    const P = fs.addDir(N, 'p')
    const siblings = Array.from({ length: 5000 }, (_, i) => fs.addDir(P, `s${pad(i)}`))
    const F = siblings[0]!
    const BG = fs.addDir(N, 'bg')
    const X = fs.addDir(BG, 'x')
    const ks = Array.from({ length: 50 }, (_, i) => fs.addDir(X, `k${pad(i)}`))
    const t0 = clock.now()
    // 缓存：除 k* 外都刚读过；k* 没有信息，由后台队列 ② 读取
    for (const u of [N, P, BG, X, ...siblings]) prelist(h, u, t0)
    // 每次调用 100ms（网络）
    fs.gate = (_op, _uri, signal) => clock.sleep(100, signal)
    s.setInterest(1, { ...none, focus: F })
    await clock.advance(600_000)

    const stats = fs.calls.filter((c) => c.op === 'stat').map((c) => c.at - t0)
    // 稳态（近层在 60 秒时到期之后）：平均不超过 5 次 / 秒
    const steady = stats.filter((t) => t >= 60_000 && t < 600_000)
    expect(steady.length / 540).toBeLessThanOrEqual(5)
    // 任意 1 秒内：非关注点的定期确认最多 5 次，另有关注点与后台各至多 1 次
    for (let i = 0; i < stats.length; i++) {
      const n = stats.filter((t) => t >= stats[i]! && t < stats[i]! + 1000).length
      expect(n, `at ${stats[i]}`).toBeLessThanOrEqual(7)
    }
    // 后台队列照常推进：50 个没有信息的目录在 3 分钟内读完（休息 2 秒 / 个）
    const listedBy = (u: string): number | undefined =>
      fs.calls.find((c) => c.op === 'list' && c.uri === u)?.at
    for (const k of ks) {
      const at = listedBy(k)
      expect(at, k).toBeDefined()
      expect(at! - t0, k).toBeLessThan(180_000)
    }
  })

  it('recomputing the scope reads a bounded number of directory rows', async () => {
    const h = setup([root(R, 'default')])
    const { clock, fs, cache, s } = h
    const P = fs.addDir(R, 'p')
    const siblings = Array.from({ length: 5000 }, (_, i) => fs.addDir(P, `s${pad(i)}`))
    const V = fs.addDir(R, 'v')
    for (const u of [R, P, ...siblings]) prelist(h, u, clock.now())
    s.setInterest(1, { ...none, focus: siblings[0]! })
    await clock.advance(1000)
    let reads = 0
    const getDir = cache.getDir.bind(cache)
    cache.getDir = (uri: string) => {
      reads += 1
      return getDir(uri)
    }
    // 只改变可见范围：重新计算范围，不触发检查
    s.setInterest(1, { focus: siblings[0]!, visible: [V], offscreen: [] })
    await clock.advance(0)
    expect(reads).toBeGreaterThan(0)
    expect(reads).toBeLessThanOrEqual(3 * TIER_LIMIT)
  })
})
