/**
 * 调度器测试的共用夹具（scheduler.test.ts、scheduler-remote.test.ts）：
 * 假时钟与计时器、内存中的假枚举器、内存缓存。各测试文件在 afterEach 中调用 disposeHarnesses
 */
import {
  AppError,
  type ErrorCode,
  type LocationKind,
  type RootConfig,
  type ScanSettings
} from '@pch/shared'
import { createLocator } from '../../main/vfs/location'
import { Cache, childUri } from '../cache/cache'
import type { Enumerator, RawEntry } from '../enum/types'
import { Scheduler } from './scheduler'

/** 注入的时钟与计时器：advance 依次触发到期的计时器，每次之后让微任务跑完（不做真实等待） */
export class FakeClock {
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

  /** 系统时钟回拨：now() 变小，已设置的计时器仍按剩余时长触发（与真实的 setTimeout 一样） */
  rollback(ms: number): void {
    this.t -= ms
    for (const e of this.timers.values()) e.at -= ms
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

export const flush = async (): Promise<void> => {
  for (let i = 0; i < 3; i++) await new Promise<void>((r) => setImmediate(r))
}

/** 只在中止时失败（模拟会响应中止的卡住调用） */
export const hang = (signal: AbortSignal): Promise<void> =>
  new Promise((_, reject) =>
    signal.addEventListener('abort', () => reject(signal.reason), { once: true })
  )

export type Gate = (
  op: 'stat' | 'list',
  uri: string,
  signal: AbortSignal,
  onBatch: () => void
) => Promise<void> | undefined

export interface FakeDir {
  mtime: number
  entries: RawEntry[]
}

/** 内存中的目录树；记录每次调用与每台主机的同时调用数 */
export class FakeFs implements Enumerator {
  readonly native = true
  readonly dirs = new Map<string, FakeDir>()
  /** userAction：调度器传给枚举器的值（远程目录的重连与重试只用于用户操作） */
  readonly calls: { op: 'stat' | 'list'; uri: string; at: number; userAction: boolean }[] = []
  readonly errors = new Map<string, ErrorCode>()
  /** 只在下一次调用时返回的错误（例如上级目录改名期间的一次读取） */
  readonly failOnce = new Map<string, ErrorCode>()
  readonly inFlight = new Map<string, number>()
  readonly maxInFlight = new Map<string, number>()
  maxTotal = 0
  gate: Gate | undefined
  private total = 0
  private readonly loc = createLocator(null)

  constructor(private readonly clock: FakeClock) {}

  location = (u: string): LocationKind => this.loc.location(u)
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

  /**
   * 删除目录及其子树，父目录的条目保留：父目录的真实列表仍把它列为目录，读取它本身却失败
   * （配合 errors 模拟各种异常）。真实的删除用 remove
   */
  rmdir(uri: string): void {
    for (const u of [...this.dirs.keys()])
      if (u === uri || u.startsWith(`${uri}/`)) this.dirs.delete(u)
  }

  /** 真实的删除：删除目录及其子树，并从父目录的列表中删除该项（父目录的修改时间随之变化） */
  remove(parent: string, name: string): void {
    this.rmdir(childUri(parent, name))
    const d = this.dirs.get(parent)
    if (!d) return
    d.entries = d.entries.filter((e) => e.name !== name)
    d.mtime += 1
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

  statDir(
    uri: string,
    signal: AbortSignal,
    opts?: { userAction?: boolean }
  ): Promise<{ mtime: number }> {
    return this.op(
      'stat',
      uri,
      signal,
      () => {},
      (d) => ({ mtime: d.mtime }),
      opts?.userAction ?? false
    )
  }

  list(
    uri: string,
    opts: { signal: AbortSignal; onBatch: () => void; userAction?: boolean }
  ): Promise<RawEntry[]> {
    return this.op(
      'list',
      uri,
      opts.signal,
      opts.onBatch,
      (d) => {
        opts.onBatch()
        return d.entries.map((e) => ({ ...e }))
      },
      opts.userAction ?? false
    )
  }

  private async op<T>(
    op: 'stat' | 'list',
    uri: string,
    signal: AbortSignal,
    onBatch: () => void,
    done: (d: FakeDir) => T,
    userAction: boolean
  ): Promise<T> {
    this.calls.push({ op, uri, at: this.clock.now(), userAction })
    const host = this.hostKey(uri)
    this.track(host, 1)
    try {
      await this.gate?.(op, uri, signal, onBatch)
      const once = this.failOnce.get(uri)
      if (once) {
        this.failOnce.delete(uri)
        throw new AppError({ code: once, detail: uri })
      }
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
export const settings: ScanSettings = {
  interval: {
    focus: { local: 5, network: 10 },
    near: { local: 30, network: 60 },
    far: { local: 120, network: 300 }
  },
  backgroundGapMs: { local: 500, network: 2000, remote: 500 },
  timeoutSec: { local: 5, network: 10, remote: 20 },
  remoteIndexIntervalSec: 1800,
  activeDepth: 3
}

export const root = (
  uri: string,
  strategy: RootConfig['strategy'] = 'passive',
  location: RootConfig['location'] = uri.startsWith('file:///') ? 'local' : 'network'
): RootConfig => ({ entryId: `e-${uri}`, workspaceId: 'w', uri, strategy, location })

export const none = { focus: null, visible: [], offscreen: [], tabs: [] }

const disposers: (() => void)[] = []

/** 各测试文件在 afterEach 中调用：释放 setup 创建的调度器与缓存 */
export function disposeHarnesses(): void {
  for (const d of disposers.splice(0)) d()
}

export interface Harness {
  clock: FakeClock
  fs: FakeFs
  cache: Cache
  changed: string[]
  reach: [string, 'online' | 'offline', number][]
  logs: [string, string][]
  s: Scheduler
}

export function setup(
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
export function prelist(h: Harness, uri: string, at: number): void {
  const d = h.fs.dirs.get(uri)!
  h.cache.applyListing(uri, d.mtime, d.entries, at)
}
