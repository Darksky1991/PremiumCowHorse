import {
  AppError,
  type DirectoryListing,
  type FileEntry,
  type Interest,
  type RootConfig,
  type ScanSettings
} from '@pch/shared'
import { toAppError } from '../../main/vfs/errors'
import { fileUriToLocalPath } from '../../main/vfs/local-path'
import { childUri, isUnder, type Cache } from '../cache/cache'
import type { Enumerator, RawEntry } from '../enum/types'
import { backoffMs } from './backoff'
import { computeScope, parentUri, type FrontierItem, type Tier } from './scope'

export interface SchedulerEvents {
  /** 目录的缓存内容（列表或状态）有变化 */
  changed(uri: string): void
  reachability(share: string, state: 'online' | 'offline', since: number): void
}

/** 窗口的关注点：定义在 shared（主进程的 ScannerClient 与扫描进程共用） */
export type { Interest }

export interface SchedulerDeps {
  enumerator: Enumerator
  cache: Cache
  events: SchedulerEvents
  now?: () => number
  setTimer?: typeof setTimeout
  clearTimer?: typeof clearTimeout
  /**
   * libuv 线程池的大小（koffi 异步调用与 fs 都在其中执行）。同时进行的原生调用不超过它：
   * 多出的调用只会在 libuv 内排队，而看门狗从发出调用起计时，会把排队误判为超时。
   * 默认取 UV_THREADPOOL_SIZE，未设置时为 libuv 的默认值 4。
   */
  threadPoolSize?: number
  /** 调度器自身的异常等（Task 5 接到主进程日志）；默认不输出 */
  log?: (level: 'info' | 'warn' | 'error', message: string) => void
}

/** 无论修改时间是否变化，listed_at 超过此时长就完整枚举一次（兜底修改时间的粒度与例外） */
export const LIST_MAX_AGE_MS = 3_600_000
/** 同一目录的 P0 在此时长内去重 */
export const P0_DEDUPE_MS = 2000
/** listNow：检查时刻在此时长内视为 fresh */
export const FRESH_MS = 2000
/** 同一主机两次 P2 之间的最短停顿 */
export const P2_GAP_MS = 200
/** 参与范围计算的热点目录数 */
export const HOT_K = 20
/** 本地位置（所有卷合计）同时进行的检查上限 */
export const LOCAL_LIMIT = 4
/** pump 出错后重试的间隔 */
export const PUMP_RETRY_MS = 1000

/** 设计 4.9 的默认值：configure 之前（例如启动时的 listNow）使用 */
const DEFAULT_SETTINGS: ScanSettings = {
  intervalSec: { local: 5, network: 30 },
  backgroundIntervalMin: 10,
  timeoutSec: { local: 5, network: 10 },
  activeDepth: 3
}

type Prio = 'P0' | 'P1' | 'P2' | 'probe'
/** 每个位置组（本地卷 / 网络主机）的两条并发通道：P0 专用 1 个、P1/P2/探测共用 1 个 */
type Lane = 'p0' | 'bg'

interface Waiter {
  resolve: (l: DirectoryListing) => void
  reject: (e: AppError) => void
  /** 开始等待的时刻：排队超过 timeoutSec 以 FS_TIMEOUT 拒绝 */
  since: number
}

interface Walk {
  /** 当前层的目录（已处理的留到本层结束，用于取下一层） */
  level: WalkItem[]
  cursor: number
  running: boolean
}

interface WalkItem {
  uri: string
  /** 还可以向下展开的层数；null 为不限 */
  left: number | null
  /** 跳过（断开、已离开范围）：不展开 */
  skip: boolean
}

interface Task {
  uri: string
  prio: Prio
  /** true=直接完整枚举；false=先比较目录修改时间 */
  full: boolean
  waiters: Waiter[]
  /** refresh：在共享断开时也尝试一次 */
  bypass: boolean
  walk?: Walk
}

type Outcome = { ok: true; entries: RawEntry[] | null; at: number } | { ok: false; error: AppError }

/** 一次检查的运行状态：raw 为最近一次原生调用（settle 之前一直占着并发名额） */
interface Run {
  controller: AbortController | null
  timer: ReturnType<typeof setTimeout> | undefined
  raw: Promise<void>
  batches: number
}

interface Owner extends Interest {
  focused: boolean
}

interface P1Item {
  tier: Tier
  full: boolean
  next: number
}

interface Offline {
  since: number
  attempt: number
  probeUri: string
  nextProbe: number
  probing: boolean
}

interface Slot {
  local: boolean
  group: string
  lane: Lane
}

const errorText = (e: unknown): string => (e instanceof Error ? (e.stack ?? e.message) : String(e))

const cancelled = (): AppError => new AppError({ code: 'FS_CANCELLED' })
const unavailable = (uri: string): AppError => new AppError({ code: 'FS_UNAVAILABLE', detail: uri })

/** RawEntry → FileEntry：子项 URI 与缓存、LocalProvider 用同一个函数生成 */
function toFileEntry(dirUri: string, e: RawEntry): FileEntry {
  const f: FileEntry = {
    uri: childUri(dirUri, e.name),
    name: e.name,
    kind: e.kind,
    size: e.size,
    mtime: e.mtime,
    hidden: e.hidden
  }
  if (e.kind === 'symlink') f.target = e.target ?? null
  return f
}

/** 无法转换为本地路径的 URI（非 file:、格式错误）：返回错误；有效时返回 null */
function uriError(uri: string): AppError | null {
  try {
    fileUriToLocalPath(uri)
    return null
  } catch (e) {
    return toAppError(e)
  }
}

const isValidUri = (uri: string): boolean => uriError(uri) === null

/** uri 在 ancestor 之下的层数（ancestor 本身为 0）；调用方保证 isUnder(uri, ancestor) */
function depthBelow(ancestor: string, uri: string): number {
  if (uri === ancestor) return 0
  return uri.slice(ancestor.length).replace(/^\//, '').split('/').length
}

/** a 的展开范围是否已包含 b 的展开范围 */
function covers(a: FrontierItem, b: FrontierItem): boolean {
  if (!isUnder(b.uri, a.uri)) return false
  if (a.maxDepth === null) return true
  if (b.maxDepth === null) return false
  return depthBelow(a.uri, b.uri) + b.maxDepth <= a.maxDepth
}

/**
 * 调度器（扫描进程，设计 4.3 / 4.6 / 4.7）：按优先级安排目录检查，维护缓存并发出通知。
 *
 * - P0：用户动作（listNow、refresh、关注点变化、窗口重新获得焦点、回到视口），立即；同一目录 2 秒内去重。
 * - P1：各窗口范围（computeScope）中的目录，按位置的刷新间隔；所有窗口都失焦（或没有窗口）时暂停。
 * - P2：frontier（「积极」的上下 N 级、「全部」、建立索引）每 backgroundIntervalMin 分钟一轮，
 *   按层广度优先，用游标从 cache.childDirs 取下一层，同时只在内存中保存一层的目录。
 * - 并发：本地最多 4 个；网络每台主机 P1/P2/探测 1 个 + P0 1 个；总数不超过线程池。
 *   被看门狗中止的调用在真正返回之前继续占着名额（koffi 调用无法中途取消，线程仍被占用）。
 * - 看门狗：从调用开始与每次 onBatch 起计时，超过 timeoutSec 没有进展即中止。
 * - 断开：探测（statDir，或枚举的第一批之前）超时 / FS_UNAVAILABLE → 该共享断开，只按退避探测一个目录。
 */
export class Scheduler {
  private readonly enumerator: Enumerator
  private readonly cache: Cache
  private readonly events: SchedulerEvents
  private readonly now: () => number
  private readonly setTimer: typeof setTimeout
  private readonly clearTimer: typeof clearTimeout
  private readonly threadPool: number
  private readonly log: (level: 'info' | 'warn' | 'error', message: string) => void

  private roots: RootConfig[] = []
  private rootUris = new Set<string>()
  private indexTargets: string[] = []
  private settings: ScanSettings = DEFAULT_SETTINGS
  private configKey: string | null = null

  private readonly owners = new Map<number, Owner>()
  private p1 = new Map<string, P1Item>()
  private frontier: FrontierItem[] = []
  private scopeDirty = false

  /** 待执行的 P0（插入顺序 = 先进先出） */
  private readonly p0 = new Map<string, Task>()
  /** 最近完成 P0 的时刻（去重用） */
  private readonly p0Done = new Map<string, number>()
  private readonly running = new Map<string, Task>()
  private readonly runs = new Set<Run>()
  private readonly offline = new Map<string, Offline>()

  // P2 一轮的状态：按主机分组，每组一个按层前进的游标
  private readonly walks = new Map<string, Walk>()
  private readonly p2NextAt = new Map<string, number>()
  private roundFrontier: FrontierItem[] = []
  private roundActive = false
  private roundStart = 0
  private nextRoundAt = 0

  private inFlight = { total: 0, local: 0, network: 0 }
  /** 位置组（groupKey）→ 各通道占用数 */
  private readonly groupLanes = new Map<string, Record<Lane, number>>()

  private wake: { at: number; timer: ReturnType<typeof setTimeout> } | null = null
  private pumpQueued = false
  private disposed = false

  constructor(deps: SchedulerDeps) {
    this.enumerator = deps.enumerator
    this.cache = deps.cache
    this.events = deps.events
    this.now = deps.now ?? Date.now
    this.setTimer = deps.setTimer ?? setTimeout
    this.clearTimer = deps.clearTimer ?? clearTimeout
    this.log = deps.log ?? ((): void => {})
    this.threadPool = Math.max(
      1,
      deps.threadPoolSize ?? (Number(process.env['UV_THREADPOOL_SIZE']) || 4)
    )
  }

  /**
   * roots：参与调度的根（当前工作区，多窗口时为其和）；allRootUris：所有工作区的 folder 条目
   * （缓存只保存这些根之下的目录）。配置变化后清理一次不在任何根之下的缓存。
   */
  configure(
    roots: RootConfig[],
    indexTargets: string[],
    settings: ScanSettings,
    allRootUris: string[]
  ): void {
    if (this.disposed) return
    // 位置判断对无效 URI 会抛出：入口处滤掉，调度循环内不再处理
    this.roots = roots.filter((r) => isValidUri(r.uri)).map((r) => ({ ...r }))
    this.rootUris = new Set([...allRootUris, ...roots.map((r) => r.uri)].filter(isValidUri))
    this.indexTargets = indexTargets.filter(isValidUri)
    this.settings = settings
    this.cache.setRoots([...this.rootUris])
    const key = JSON.stringify([roots, indexTargets, settings, [...this.rootUris].sort()])
    if (key !== this.configKey) {
      this.configKey = key
      this.cache.prune()
    }
    this.invalidateScope()
  }

  setInterest(ownerId: number, interest: Interest): void {
    if (this.disposed) return
    const prev = this.owners.get(ownerId)
    // 发来关注点的窗口视为正在使用；之后以 setWindowFocus 为准
    const o: Owner = {
      focused: prev?.focused ?? true,
      focus: interest.focus !== null && isValidUri(interest.focus) ? interest.focus : null,
      visible: interest.visible.filter(isValidUri),
      offscreen: interest.offscreen.filter(isValidUri)
    }
    this.owners.set(ownerId, o)
    if (o.focus !== null && o.focus !== prev?.focus) {
      this.cache.visit(o.focus, this.now())
      this.requestP0(o.focus)
    }
    // 滚回视口的已展开目录：立即完整枚举一次
    if (prev) {
      const wasOffscreen = new Set(prev.offscreen)
      for (const v of o.visible) if (wasOffscreen.has(v)) this.requestP0(v)
    }
    this.invalidateScope()
  }

  setWindowFocus(ownerId: number, focused: boolean): void {
    if (this.disposed) return
    const o = this.owners.get(ownerId)
    if (!o) {
      this.owners.set(ownerId, { focused, focus: null, visible: [], offscreen: [] })
      this.invalidateScope()
      return
    }
    const refocus = focused && !o.focused
    o.focused = focused
    // 断开的共享不因切回窗口而重连（requestP0 对断开的共享不排队）
    if (refocus && o.focus !== null) this.requestP0(o.focus)
    this.requestPump()
  }

  releaseOwner(ownerId: number): void {
    if (this.disposed) return
    if (this.owners.delete(ownerId)) this.invalidateScope()
  }

  /**
   * 有缓存：立即返回缓存并排 P0 检查；没有缓存：P0 枚举后返回。
   * 共享断开时不发起访问：有缓存返回 offline，没有则以 FS_UNAVAILABLE 拒绝。
   */
  listNow(uri: string): Promise<DirectoryListing> {
    if (this.disposed) return Promise.reject(cancelled())
    const invalid = uriError(uri)
    if (invalid) return Promise.reject(invalid)
    const dir = this.cache.getDir(uri)
    const cached = dir !== undefined && dir.listedAt !== null && dir.state !== 'denied'
    if (this.isOffline(uri)) {
      if (cached) return Promise.resolve(this.listing(uri, 'offline', dir.checkedAt))
      return Promise.reject(unavailable(uri))
    }
    if (cached) {
      const fresh = dir.checkedAt !== null && this.now() - dir.checkedAt <= FRESH_MS
      this.requestP0(uri)
      return Promise.resolve(this.listing(uri, fresh ? 'fresh' : 'cached', dir.checkedAt))
    }
    return new Promise((resolve, reject) =>
      this.requestP0(uri, { waiter: { resolve, reject, since: this.now() } })
    )
  }

  /** F5 / 重试：P0；共享断开时也立即尝试一次（不改变退避的时刻表） */
  refresh(uris: string[]): void {
    if (this.disposed) return
    for (const u of uris) if (isValidUri(u)) this.requestP0(u, { bypass: this.isOffline(u) })
  }

  isOffline(uri: string): boolean {
    return isValidUri(uri) && this.offline.has(this.enumerator.shareKey(uri))
  }

  /** 调试与测试用：内存中排队的目录数（P0 + P2 各组当前层）、P1 范围大小、执行中的检查数 */
  queueStats(): { queued: number; p1: number; running: number } {
    let queued = this.p0.size
    for (const w of this.walks.values()) queued += w.level.length
    return { queued, p1: this.p1.size, running: this.running.size }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    const err = cancelled()
    for (const r of this.runs) {
      this.clearTimer(r.timer)
      r.controller?.abort(err)
    }
    for (const t of [...this.p0.values(), ...this.running.values()]) {
      for (const w of t.waiters) w.reject(err)
      t.waiters = []
    }
    this.p0.clear()
    this.walks.clear()
    if (this.wake) this.clearTimer(this.wake.timer)
    this.wake = null
  }

  // ---- 排队 ----

  private requestP0(uri: string, opts: { waiter?: Waiter; bypass?: boolean } = {}): void {
    const { waiter, bypass = false } = opts
    if (this.disposed) {
      waiter?.reject(cancelled())
      return
    }
    if (this.isOffline(uri) && !bypass) {
      waiter?.reject(unavailable(uri))
      return
    }
    const queued = this.p0.get(uri)
    if (queued) {
      if (waiter) queued.waiters.push(waiter)
      if (bypass) queued.bypass = true
      return
    }
    const running = this.running.get(uri)
    if (running?.prio === 'P0' && !bypass) {
      if (waiter) running.waiters.push(waiter)
      return
    }
    if (!waiter && !bypass) {
      const done = this.p0Done.get(uri)
      if (done !== undefined && this.now() - done < P0_DEDUPE_MS) return
    }
    this.p0.set(uri, { uri, prio: 'P0', full: true, waiters: waiter ? [waiter] : [], bypass })
    this.requestPump()
  }

  private invalidateScope(): void {
    this.scopeDirty = true
    this.requestPump()
  }

  private requestPump(): void {
    if (this.pumpQueued || this.disposed) return
    this.pumpQueued = true
    queueMicrotask(() => {
      this.pumpQueued = false
      this.pump()
    })
  }

  /**
   * pump 在微任务 / 计时器中执行：其中的异常（缓存、范围计算）不得成为未捕获异常让扫描进程退出，
   * 也不得让定时唤醒丢失。出错时记日志，PUMP_RETRY_MS 后重试。
   */
  private pump(): void {
    if (this.disposed) return
    // 出错时沿用这个重试时刻
    let wakeAt = this.now() + PUMP_RETRY_MS
    try {
      wakeAt = this.pumpOnce()
    } catch (e) {
      this.log('error', `[scheduler] pump failed: ${errorText(e)}`)
    } finally {
      if (!this.disposed) this.armWake(wakeAt)
    }
  }

  /** 按 P0 → 探测 → P1 → P2 的顺序启动能启动的检查；返回最早的未来唤醒时刻 */
  private pumpOnce(): number {
    const now = this.now()
    let wakeAt = Infinity
    if (this.scopeDirty) {
      // 范围计算失败时沿用上一次的范围继续调度，稍后重试（scopeDirty 保持为 true）
      try {
        this.recompute()
      } catch (e) {
        this.log('error', `[scheduler] scope computation failed: ${errorText(e)}`)
        wakeAt = now + PUMP_RETRY_MS
      }
    }

    for (const task of [...this.p0.values()]) {
      if (this.isOffline(task.uri) && !task.bypass) {
        this.p0.delete(task.uri)
        for (const w of task.waiters) w.reject(unavailable(task.uri))
        continue
      }
      if (!this.running.has(task.uri) && this.canStart(task.uri, 'p0')) {
        this.p0.delete(task.uri)
        this.start(task, 'p0')
        continue
      }
      // 仍在排队：等待超过 timeoutSec 的调用方以 FS_TIMEOUT 拒绝（通道被不返回的调用占着时
      // 不让界面一直「加载中」）；任务本身留在队列中，通道空出后照常检查
      const limit = this.timeoutMs(task.uri)
      task.waiters = task.waiters.filter((w) => {
        if (now - w.since < limit) {
          wakeAt = Math.min(wakeAt, w.since + limit)
          return true
        }
        w.reject(new AppError({ code: 'FS_TIMEOUT', detail: `queued: ${task.uri}` }))
        return false
      })
    }

    for (const off of this.offline.values()) {
      if (off.probing) continue
      if (off.nextProbe > now) {
        wakeAt = Math.min(wakeAt, off.nextProbe)
        continue
      }
      if (this.running.has(off.probeUri) || !this.canStart(off.probeUri, 'bg')) continue
      off.probing = true
      this.start({ uri: off.probeUri, prio: 'probe', full: false, waiters: [], bypass: true }, 'bg')
    }

    const focused = [...this.owners.values()].some((o) => o.focused)
    const due: [string, P1Item][] = []
    for (const e of this.p1) {
      // P1 层在所有窗口失焦时暂停；P2 层的条目照常
      if (e[1].tier === 'P1' && !focused) continue
      if (e[1].next <= now) due.push(e)
      else wakeAt = Math.min(wakeAt, e[1].next)
    }
    due.sort((a, b) => a[1].next - b[1].next)
    for (const [uri, it] of due) {
      if (this.running.has(uri) || this.isOffline(uri) || !this.canStart(uri, 'bg')) continue
      this.start({ uri, prio: it.tier, full: it.full, waiters: [], bypass: false }, 'bg')
    }

    return Math.min(wakeAt, this.pumpBackground(now))
  }

  private armWake(at: number): void {
    if (this.wake?.at === at) return
    if (this.wake) this.clearTimer(this.wake.timer)
    this.wake = null
    if (!Number.isFinite(at)) return
    const timer = this.setTimer(
      () => {
        this.wake = null
        this.pump()
      },
      Math.max(0, at - this.now())
    )
    this.wake = { at, timer }
  }

  // ---- 范围 ----

  /** 各 owner 分别计算范围后合并（同一 URI 取更强的 tier 与 full）；没有 owner 时按无关注点计算 */
  private recompute(): void {
    const hot = this.cache.hot(HOT_K)
    const children = (u: string): string[] => this.cache.childDirs(u)
    const interests: Interest[] =
      this.owners.size > 0
        ? [...this.owners.values()]
        : [{ focus: null, visible: [], offscreen: [] }]
    const items = new Map<string, { tier: Tier; full: boolean }>()
    const frontier = new Map<string, number | null>()
    for (const i of interests) {
      const r = computeScope({
        roots: this.roots,
        focus: i.focus,
        visible: i.visible,
        offscreen: i.offscreen,
        hot,
        indexTargets: this.indexTargets,
        activeDepth: this.settings.activeDepth,
        children
      })
      for (const it of r.items) {
        const cur = items.get(it.uri)
        items.set(it.uri, {
          tier: cur?.tier === 'P1' || it.tier === 'P1' ? 'P1' : 'P2',
          full: (cur?.full ?? false) || it.full
        })
      }
      for (const f of r.frontier) {
        const cur = frontier.get(f.uri)
        if (cur === undefined) frontier.set(f.uri, f.maxDepth)
        else
          frontier.set(
            f.uri,
            cur === null || f.maxDepth === null ? null : Math.max(cur, f.maxDepth)
          )
      }
    }

    const now = this.now()
    const next = new Map<string, P1Item>()
    for (const [uri, it] of items) {
      const prev = this.p1.get(uri)
      if (prev) {
        next.set(uri, { ...it, next: prev.next })
        continue
      }
      // 新进入范围：按上次检查的时刻排期（刚检查过的不立即重复）
      const checkedAt = this.cache.getDir(uri)?.checkedAt ?? null
      next.set(uri, {
        ...it,
        next: checkedAt === null ? now : checkedAt + this.intervalFor(uri, it.tier)
      })
    }
    this.p1 = next
    this.setFrontier([...frontier].map(([uri, maxDepth]) => ({ uri, maxDepth })))
    this.scopeDirty = false
  }

  private intervalFor(uri: string, tier: Tier): number {
    const dir = this.cache.getDir(uri)
    // 出错的目录（权限、超时）按 P2 间隔重试
    if (tier === 'P2' || (dir !== undefined && dir.state !== 'ok')) {
      return this.settings.backgroundIntervalMin * 60_000
    }
    return this.settings.intervalSec[this.enumerator.location(uri)] * 1000
  }

  // ---- P2 ----

  /** frontier 变化：一轮进行中（或两轮之间）出现的、未被本轮覆盖的起点立即加入 */
  private setFrontier(list: FrontierItem[]): void {
    this.frontier = list
    if (!this.roundActive && this.now() >= this.nextRoundAt) return // 下一轮马上开始
    for (const f of list) this.addToRound(f)
  }

  private addToRound(f: FrontierItem): void {
    if (this.roundFrontier.some((g) => covers(g, f))) return
    this.roundFrontier.push(f)
    const key = this.groupKey(f.uri)
    let walk = this.walks.get(key)
    if (!walk) {
      walk = { level: [], cursor: 0, running: false }
      this.walks.set(key, walk)
    }
    walk.level.push({ uri: f.uri, left: f.maxDepth, skip: false })
    this.roundActive = true
  }

  private startRound(now: number): void {
    this.roundStart = now
    this.nextRoundAt = now + this.settings.backgroundIntervalMin * 60_000
    this.roundFrontier = []
    this.walks.clear()
    // 范围大的起点先加入，被它覆盖的起点不重复
    const sorted = [...this.frontier].sort((a, b) => a.uri.length - b.uri.length)
    for (const f of sorted) if (f.maxDepth === null) this.addToRound(f)
    for (const f of sorted) if (f.maxDepth !== null) this.addToRound(f)
  }

  /** 每个主机组最多启动 1 个 P2；返回下一次需要唤醒的时刻 */
  private pumpBackground(now: number): number {
    if (!this.roundActive) {
      if (this.frontier.length === 0) return Infinity
      if (now < this.nextRoundAt) return this.nextRoundAt
      this.startRound(now)
    }
    let wakeAt = Infinity
    for (const [key, walk] of this.walks) {
      if (walk.running) continue
      const gate = this.p2NextAt.get(key) ?? 0
      if (gate > now) {
        wakeAt = Math.min(wakeAt, gate)
        continue
      }
      for (;;) {
        if (walk.cursor >= walk.level.length) {
          if (!this.advanceLevel(walk)) {
            this.walks.delete(key)
            break
          }
          continue
        }
        const it = walk.level[walk.cursor]!
        // 断开的共享、已离开 frontier 的目录：本轮跳过（不展开）
        if (this.isOffline(it.uri) || !this.frontier.some((f) => isUnder(it.uri, f.uri))) {
          it.skip = true
          walk.cursor += 1
          continue
        }
        // 本轮已由其他优先级检查过：只展开，不重复检查
        const checkedAt = this.cache.getDir(it.uri)?.checkedAt ?? null
        if (checkedAt !== null && checkedAt >= this.roundStart) {
          walk.cursor += 1
          continue
        }
        if (this.running.has(it.uri) || !this.canStart(it.uri, 'bg')) break
        walk.cursor += 1
        walk.running = true
        this.start({ uri: it.uri, prio: 'P2', full: false, waiters: [], bypass: false, walk }, 'bg')
        break
      }
    }
    if (this.walks.size === 0) {
      this.roundActive = false
      return Math.min(wakeAt, this.nextRoundAt)
    }
    return wakeAt
  }

  /** 本层处理完：从缓存取各目录的子目录作为下一层；没有下一层返回 false */
  private advanceLevel(walk: Walk): boolean {
    const next: WalkItem[] = []
    for (const it of walk.level) {
      if (it.skip || it.left === 0) continue
      const left = it.left === null ? null : it.left - 1
      for (const c of this.cache.childDirs(it.uri)) next.push({ uri: c, left, skip: false })
    }
    walk.level = next
    walk.cursor = 0
    return next.length > 0
  }

  // ---- 并发 ----

  /**
   * 并发分组：本地按卷（shareKey，如 'C:'），网络按主机（hostKey）。
   * 一个卡住的卷 / 主机最多占 2 个线程（后台 1 + P0 1），不影响其他组。
   */
  private groupKey(uri: string): string {
    return this.enumerator.location(uri) === 'local'
      ? this.enumerator.shareKey(uri)
      : this.enumerator.hostKey(uri)
  }

  /**
   * 每组 P1/P2/探测 1 个 + P0 1 个；本地合计不超过 LOCAL_LIMIT；总数不超过线程池。
   * 本地合计、网络合计、单个组都不得占用最后一个线程（线程池 − 1），卡住的一方不会堵死另一方。
   */
  private canStart(uri: string, lane: Lane): boolean {
    const cap = Math.max(1, this.threadPool - 1)
    if (this.inFlight.total >= this.threadPool) return false
    if (this.enumerator.location(uri) === 'local') {
      if (this.inFlight.local >= Math.min(LOCAL_LIMIT, cap)) return false
    } else if (this.inFlight.network >= cap) return false
    const g = this.groupLanes.get(this.groupKey(uri))
    if (!g) return true
    return g[lane] < 1 && g.p0 + g.bg < cap
  }

  private acquire(uri: string, lane: Lane): Slot {
    const local = this.enumerator.location(uri) === 'local'
    const group = this.groupKey(uri)
    this.inFlight.total += 1
    if (local) this.inFlight.local += 1
    else this.inFlight.network += 1
    const g = this.groupLanes.get(group) ?? { p0: 0, bg: 0 }
    g[lane] += 1
    this.groupLanes.set(group, g)
    return { local, group, lane }
  }

  private release(slot: Slot): void {
    this.inFlight.total -= 1
    if (slot.local) this.inFlight.local -= 1
    else this.inFlight.network -= 1
    const g = this.groupLanes.get(slot.group)
    if (g) {
      g[slot.lane] -= 1
      if (g.p0 === 0 && g.bg === 0) this.groupLanes.delete(slot.group)
    }
  }

  // ---- 执行 ----

  private start(task: Task, lane: Lane): void {
    const slot = this.acquire(task.uri, lane)
    this.running.set(task.uri, task)
    const run: Run = { controller: null, timer: undefined, raw: Promise.resolve(), batches: 0 }
    this.runs.add(run)
    void this.execute(task, run)
      .catch((e: unknown): Outcome => ({ ok: false, error: toAppError(e) }))
      .then((outcome) => {
        this.runs.delete(run)
        this.running.delete(task.uri)
        // 名额在原生调用真正返回后才释放（被中止但仍卡在系统调用中的线程照样被占用）
        void run.raw.then(() => {
          this.release(slot)
          this.requestPump()
        })
        if (this.disposed) {
          for (const w of task.waiters) w.reject(cancelled())
          return
        }
        try {
          this.finish(task, outcome)
        } catch (e) {
          // 不留下永远挂起的调用方
          this.log('error', `[scheduler] finishing ${task.uri} failed: ${errorText(e)}`)
          for (const w of task.waiters) w.reject(toAppError(e))
        }
        this.requestPump()
      })
  }

  private finish(task: Task, outcome: Outcome): void {
    const { uri } = task
    const now = this.now()
    if (task.prio === 'P0') {
      this.p0Done.set(uri, now)
      if (this.p0Done.size > 256) {
        for (const [u, t] of this.p0Done) if (now - t >= P0_DEDUPE_MS) this.p0Done.delete(u)
      }
    }
    if (task.prio === 'probe') {
      const off = this.offline.get(this.enumerator.shareKey(uri))
      if (off) off.probing = false
    }
    if (task.walk) {
      task.walk.running = false
      // 停顿只用于网络主机（设计 4.6：同一服务器的两个目录之间）；本地卷不停顿
      if (this.enumerator.location(uri) === 'network') {
        this.p2NextAt.set(this.groupKey(uri), now + P2_GAP_MS)
      }
    }
    const item = this.p1.get(uri)
    if (item && task.prio !== 'probe') item.next = now + this.intervalFor(uri, item.tier)

    if (task.waiters.length === 0) return
    if (outcome.ok) {
      const checkedAt = this.cache.getDir(uri)?.checkedAt ?? outcome.at
      const listing = this.listing(uri, 'fresh', checkedAt, outcome.entries ?? undefined)
      for (const w of task.waiters) w.resolve(listing)
    } else {
      for (const w of task.waiters) w.reject(outcome.error)
    }
  }

  /** 一次检查：statDir（探测）→ 需要时枚举 → 写缓存与通知。不抛出 */
  private async execute(task: Task, run: Run): Promise<Outcome> {
    const { uri } = task
    const share = this.enumerator.shareKey(uri)
    let probe = true
    try {
      const { mtime } = await this.guard(uri, run, (signal) => this.enumerator.statDir(uri, signal))
      if (this.disposed) return { ok: false, error: cancelled() }
      this.markReachable(share)
      const t = this.now()
      if (task.prio === 'probe') return { ok: true, entries: null, at: t }

      const dir = this.cache.getDir(uri)
      const needList =
        task.full ||
        dir === undefined ||
        dir.listedAt === null ||
        dir.state !== 'ok' ||
        t - dir.listedAt >= LIST_MAX_AGE_MS ||
        dir.dirMtime !== mtime
      if (!needList) {
        this.cache.markChecked(uri, t)
        return { ok: true, entries: null, at: t }
      }

      run.batches = 0
      const entries = await this.guard(uri, run, (signal, onBatch) =>
        this.enumerator.list(uri, { signal, onBatch })
      )
      probe = false
      if (this.disposed) return { ok: false, error: cancelled() }
      const at = this.now()
      const { changed } = this.cache.applyListing(uri, mtime, entries, at)
      if (changed) {
        this.events.changed(uri)
        if (this.p1.has(uri)) this.scopeDirty = true
      }
      return { ok: true, entries, at }
    } catch (e) {
      const error = toAppError(e)
      if (this.disposed || error.code === 'FS_CANCELLED') return { ok: false, error }
      // 枚举阶段：拿到第一批之前仍算探测
      this.handleError(task, error, probe && run.batches === 0)
      return { ok: false, error }
    }
  }

  private handleError(task: Task, error: AppError, probe: boolean): void {
    const { uri } = task
    const share = this.enumerator.shareKey(uri)
    // 有意的选择：FS_UNAVAILABLE 无论出现在探测还是枚举中途（已有批次）都判为断开——枚举器只把
    // 确定的网络 / 设备类错误码映射为它（win32-enumerator 的 UNAVAILABLE_ERRORS；其他未知错误码为
    // UNKNOWN，只记该目录 unreachable），它是系统报告的连接中断，不是「慢」；只有超时区分阶段
    // （中途超时只算该目录的错误）
    if (error.code === 'FS_UNAVAILABLE' || (error.code === 'FS_TIMEOUT' && probe)) {
      this.goOffline(share, uri, task.prio === 'probe')
      return
    }
    // 其他错误说明共享有响应
    this.markReachable(share)
    if (error.code === 'FS_NOT_FOUND' || error.code === 'FS_NOT_A_DIRECTORY') {
      const dir = this.cache.getDir(uri)
      if (!dir) return
      this.cache.removeSubtree(uri)
      this.scopeDirty = true
      const notify = this.rootUris.has(uri) ? uri : (dir.parentUri ?? parentUri(uri))
      if (notify !== null) this.events.changed(notify)
      return
    }
    const state = error.code === 'FS_PERMISSION_DENIED' ? 'denied' : 'unreachable'
    const { changed } = this.cache.setState(uri, state, error.code, this.now())
    if (changed) this.events.changed(uri)
  }

  private goOffline(share: string, uri: string, fromProbe: boolean): void {
    const now = this.now()
    const off = this.offline.get(share)
    if (!off) {
      this.offline.set(share, {
        since: now,
        attempt: 0,
        probeUri: uri,
        nextProbe: now + backoffMs(0),
        probing: false
      })
      this.events.reachability(share, 'offline', now)
      return
    }
    // 只有退避探测本身的失败推进时刻表；refresh 的一次尝试不影响
    if (fromProbe) {
      off.attempt += 1
      off.nextProbe = now + backoffMs(off.attempt)
    }
  }

  private markReachable(share: string): void {
    if (!this.offline.delete(share)) return
    this.events.reachability(share, 'online', this.now())
    for (const o of this.owners.values()) {
      if (o.focus !== null && this.enumerator.shareKey(o.focus) === share) this.requestP0(o.focus)
    }
    this.requestPump()
  }

  /** 看门狗：从调用开始与每次 onBatch 起计时，超过 timeoutSec 没有进展即以 FS_TIMEOUT 中止 */
  private guard<T>(
    uri: string,
    run: Run,
    call: (signal: AbortSignal, onBatch: () => void) => Promise<T>
  ): Promise<T> {
    const ms = this.timeoutMs(uri)
    const controller = new AbortController()
    run.controller = controller
    return new Promise<T>((resolve, reject) => {
      const arm = (): void => {
        this.clearTimer(run.timer)
        run.timer = this.setTimer(() => {
          const err = new AppError({ code: 'FS_TIMEOUT', detail: uri })
          controller.abort(err)
          reject(err)
        }, ms)
      }
      arm()
      let raw: Promise<T>
      try {
        raw = call(controller.signal, () => {
          run.batches += 1
          if (!controller.signal.aborted) arm()
        })
      } catch (e) {
        raw = Promise.reject(e)
      }
      run.raw = raw.then(
        () => undefined,
        () => undefined
      )
      raw.then(
        (v) => {
          this.clearTimer(run.timer)
          resolve(v)
        },
        (e: unknown) => {
          this.clearTimer(run.timer)
          reject(e)
        }
      )
    })
  }

  private timeoutMs(uri: string): number {
    return this.settings.timeoutSec[this.enumerator.location(uri)] * 1000
  }

  private listing(
    uri: string,
    state: DirectoryListing['state'],
    checkedAt: number | null,
    entries: RawEntry[] = this.cache.getEntries(uri)
  ): DirectoryListing {
    return { items: entries.map((e) => toFileEntry(uri, e)), state, checkedAt }
  }
}
