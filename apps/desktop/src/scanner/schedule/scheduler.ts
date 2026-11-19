import {
  AppError,
  isUnderUri,
  type DirectoryListing,
  type FileEntry,
  type Interest,
  type RootConfig,
  type ScanSettings
} from '@pch/shared'
import { toAppError } from '../../main/vfs/errors'
import { fileUriToLocalPath } from '../../main/vfs/local-path'
import { childUri, type Cache, type Scope } from '../cache/cache'
import type { Enumerator, RawEntry } from '../enum/types'
import { BackgroundQueue, HOT_DEPTH } from './background-queue'
import { backoffMs } from './backoff'
import { computeScope, parentUri, TIER_RANK, type Tier } from './scope'

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

/** 同一目录的 P0 在此时长内去重 */
export const P0_DEDUPE_MS = 2000
/** listNow：检查时刻在此时长内视为 fresh；后台队列中因正在进行而跳过的候选在此时长后再看 */
export const FRESH_MS = 2000
/** 最近此时长内任一窗口的关注点 / 可见范围有变化 =「用户正在操作」：后台的休息时间加倍 */
export const BUSY_MS = 10_000
/** 参与范围计算的热点目录数 */
export const HOT_K = 20
/** 本地位置（所有卷合计）同时进行的检查上限 */
export const LOCAL_LIMIT = 4
/** pump 出错后重试的间隔 */
export const PUMP_RETRY_MS = 1000
/**
 * 每个位置组的非关注点定期确认（近 / 远层）之间的最小间隔：网络不超过 5 次 / 秒，本地 20 次 / 秒。
 * 关注点的确认不受此限。层的间隔因此是下限：到期的目录多时依次推后
 */
export const PERIODIC_GAP_MS: Record<'local' | 'network', number> = { local: 50, network: 200 }

/** 设计 8.2 / 4.9 的默认值：configure 之前（例如启动时的 listNow）使用 */
const DEFAULT_SETTINGS: ScanSettings = {
  interval: {
    focus: { local: 5, network: 10 },
    near: { local: 30, network: 60 },
    far: { local: 120, network: 300 }
  },
  backgroundGapMs: { local: 500, network: 2000 },
  timeoutSec: { local: 5, network: 10 },
  activeDepth: 3
}

type Prio = 'P0' | 'periodic' | 'background' | 'probe'
/** 每个位置组（本地卷 / 网络主机）的两条并发通道：P0 专用 1 个、定期确认 / 后台队列 / 探测共用 1 个 */
type Lane = 'p0' | 'bg'

interface Waiter {
  resolve: (l: DirectoryListing) => void
  reject: (e: AppError) => void
  /** 开始等待的时刻：排队超过 timeoutSec 以 FS_TIMEOUT 拒绝 */
  since: number
}

interface Task {
  uri: string
  prio: Prio
  /** true=直接完整枚举；false=先比较目录修改时间 */
  full: boolean
  waiters: Waiter[]
  /** refresh：在共享断开时也尝试一次 */
  bypass: boolean
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

interface PeriodicEntry {
  tier: Tier
  full: boolean
  next: number
  /** 排期所用的间隔：next 比现在晚超过它 = 系统时钟被回拨，按现在重新排期 */
  span: number
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

/**
 * 位置组记下的「下一次可以开始的时刻」。系统时钟回拨后它可能比现在晚得多：比现在晚超过 max 时
 * 改为 now + max 并写回（之后按它等待，不会每次都再往后推）。没有记录时为 -Infinity
 */
function gateAt(map: Map<string, number>, key: string, now: number, max: number): number {
  const at = map.get(key)
  if (at === undefined) return -Infinity
  if (at - now <= max) return at
  map.set(key, now + max)
  return now + max
}

const NO_INTEREST: Interest = { focus: null, visible: [], offscreen: [], tabs: [] }

/** 按关注点处理的目录：选中的关注点与标签中显示的目录（去重） */
const focusUris = (i: Interest): string[] => [
  ...new Set(i.focus === null ? i.tabs : [i.focus, ...i.tabs])
]

const sameList = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((x, i) => x === b[i])

/**
 * 调度器（扫描进程，设计 4.3 / 4.7 / 8.2）：按优先级安排目录检查，维护缓存并发出通知。缓存不设过期。
 *
 * - P0：用户动作（listNow、refresh、关注点变化、新显示在标签中的目录、窗口重新获得焦点、回到视口），立即；同一目录 2 秒内去重。
 * - 定期确认：各窗口的关注点周边按远近分层（computeScope），按层与位置的间隔；关注点与标签中显示的目录每次完整读取，
 *   近 / 远先比较目录修改时间。所有窗口都失焦（或没有窗口）时暂停。
 * - 后台队列（BackgroundQueue）：按优先级从缓存逐个选目录，每个位置组同时 1 个，完成后休息
 *   backgroundGapMs（用户正在操作时加倍）；窗口失焦时照常。
 * - 并发：本地最多 4 个；每个位置组「定期确认 / 后台队列 / 探测」共用 1 个 + P0 1 个；总数不超过线程池。
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
  private periodic = new Map<string, PeriodicEntry>()
  private readonly queue: BackgroundQueue
  /** 位置组 → 后台队列下一次可以开始的时刻（上一个完成后的休息） */
  private readonly backgroundNextAt = new Map<string, number>()
  /** 位置组 → 下一个非关注点的定期确认可以开始的时刻（PERIODIC_GAP_MS） */
  private readonly periodicNextAt = new Map<string, number>()
  /** 最近一次任一窗口的关注点 / 可见范围变化的时刻 */
  private lastInterestChange = -Infinity
  private scopeDirty = false

  /** 待执行的 P0（插入顺序 = 先进先出） */
  private readonly p0 = new Map<string, Task>()
  /** 最近完成 P0 的时刻（去重用） */
  private readonly p0Done = new Map<string, number>()
  private readonly running = new Map<string, Task>()
  private readonly runs = new Set<Run>()
  private readonly offline = new Map<string, Offline>()

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
    this.queue = new BackgroundQueue({
      cache: this.cache,
      groupKey: (u) => this.groupKey(u),
      // 后台队列不重新确认在「远」层间隔之内确认过的目录
      minAgeMs: (u) => this.settings.interval.far[this.enumerator.location(u)] * 1000,
      freshMs: FRESH_MS
    })
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
      // 根、建立索引目标或间隔可能变化：重新尝试不存在的起点，按新的间隔重新选候选
      this.queue.clearMissing()
      this.queue.invalidate()
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
      offscreen: interest.offscreen.filter(isValidUri),
      tabs: interest.tabs.filter(isValidUri)
    }
    this.owners.set(ownerId, o)
    const before = prev ?? NO_INTEREST
    if (
      o.focus !== before.focus ||
      !sameList(o.visible, before.visible) ||
      !sameList(o.offscreen, before.offscreen) ||
      !sameList(o.tabs, before.tabs)
    ) {
      this.lastInterestChange = this.now()
    }
    if (o.focus !== null && o.focus !== prev?.focus) {
      this.cache.visit(o.focus, this.now())
      this.requestP0(o.focus)
    }
    // 新显示在标签中的目录：与关注点一样立即完整读取一次
    for (const t of o.tabs) {
      if (t === o.focus || before.tabs.includes(t)) continue
      this.cache.visit(t, this.now())
      this.requestP0(t)
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
      this.owners.set(ownerId, { focused, ...NO_INTEREST })
      this.invalidateScope()
      return
    }
    const refocus = focused && !o.focused
    o.focused = focused
    // 断开的共享不因切回窗口而重连（requestP0 对断开的共享不排队）
    if (refocus) for (const u of focusUris(o)) this.requestP0(u)
    this.requestPump()
  }

  releaseOwner(ownerId: number): void {
    if (this.disposed) return
    if (this.owners.delete(ownerId)) this.invalidateScope()
  }

  /**
   * 有缓存：立即返回缓存，2 秒内检查过（fresh）则不再检查，否则排 P0；没有缓存：P0 枚举后返回。
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
      // 时钟回拨后确认时刻可能在「未来」（差为负）：不算新鲜，否则 F5 / 展开会一直失效到时钟追上
      const age = dir.checkedAt === null ? null : this.now() - dir.checkedAt
      const fresh = age !== null && age >= 0 && age <= FRESH_MS
      // 刚检查过（任何优先级，含定期确认发现变化后渲染端收到 vfs.changed 的重新列出）：不再排 P0，
      // 否则每次检测到变化都会多一次完整枚举
      if (!fresh) this.requestP0(uri)
      return Promise.resolve(this.listing(uri, fresh ? 'fresh' : 'cached', dir.checkedAt))
    }
    return new Promise((resolve, reject) =>
      this.requestP0(uri, { waiter: { resolve, reject, since: this.now() } })
    )
  }

  /**
   * F5 / 刷新按钮 / 重试：P0；共享断开时也立即尝试一次（不改变退避的时刻表）。
   * 显式刷新带 force：不被 2 秒去重（P0_DEDUPE_MS）丢弃，也不与正在执行的 P0 合并——
   * 刚完成 / 执行中的读取可能早于用户想看到的变化；已在排队的仍合并（连按不重复排队）
   */
  refresh(uris: string[]): void {
    if (this.disposed) return
    for (const u of uris) {
      if (isValidUri(u)) this.requestP0(u, { bypass: this.isOffline(u), force: true })
    }
  }

  isOffline(uri: string): boolean {
    return isValidUri(uri) && this.offline.has(this.enumerator.shareKey(uri))
  }

  /** 调试与测试用：内存中排队的目录数（P0 + 后台队列的候选）、定期确认的对象数、执行中的检查数 */
  queueStats(): { queued: number; periodic: number; running: number } {
    return {
      queued: this.p0.size + this.queue.size(),
      periodic: this.periodic.size,
      running: this.running.size
    }
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
    if (this.wake) this.clearTimer(this.wake.timer)
    this.wake = null
  }

  // ---- 排队 ----

  private requestP0(
    uri: string,
    opts: { waiter?: Waiter; bypass?: boolean; force?: boolean } = {}
  ): void {
    // force：不与刚完成 / 正在执行的 P0 合并（它们读到的可能是更正之前的状态）
    const { waiter, bypass = false, force = false } = opts
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
    if (running?.prio === 'P0' && !bypass && !force) {
      if (waiter) running.waiters.push(waiter)
      return
    }
    if (!waiter && !bypass && !force) {
      const done = this.p0Done.get(uri)
      // 差为负（时钟回拨）：不算重复
      const age = done === undefined ? null : this.now() - done
      if (age !== null && age >= 0 && age < P0_DEDUPE_MS) return
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

  /** 按 P0 → 探测 → 定期确认 → 后台队列的顺序启动能启动的检查；返回最早的未来唤醒时刻 */
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

    // 定期确认：所有窗口失焦时暂停（重新获得焦点时关注点进入 P0）
    if ([...this.owners.values()].some((o) => o.focused)) {
      const due: [string, PeriodicEntry][] = []
      for (const e of this.periodic) {
        // 系统时钟回拨：到期时刻不会比一个间隔更远
        if (e[1].next - now > e[1].span) e[1].next = now + e[1].span
        if (e[1].next <= now) due.push(e)
        else wakeAt = Math.min(wakeAt, e[1].next)
      }
      due.sort((a, b) => a[1].next - b[1].next)
      for (const [uri, it] of due) {
        // 排队中的 P0 会完整读取并重新排期（关注点与标签目录同时变化时 P0 通道上排队）
        if (this.running.has(uri) || this.p0.has(uri) || this.isOffline(uri)) continue
        // 近 / 远层：同一位置组的两次确认之间至少间隔 PERIODIC_GAP_MS
        const group = it.tier === 'focus' ? null : this.groupKey(uri)
        const gap = PERIODIC_GAP_MS[this.enumerator.location(uri)]
        const gate = group === null ? -Infinity : gateAt(this.periodicNextAt, group, now, gap)
        if (gate > now) {
          wakeAt = Math.min(wakeAt, gate)
          continue
        }
        if (!this.canStart(uri, 'bg')) continue
        this.start({ uri, prio: 'periodic', full: it.full, waiters: [], bypass: false }, 'bg')
        if (group !== null) {
          this.periodicNextAt.set(group, now + gap)
        }
      }
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

  /**
   * 各 owner 分别计算范围后合并：定期确认的对象同一 URI 取更近的层（关注点的完整读取优先），
   * 后台范围取并集。没有 owner 时按无关注点计算。
   */
  private recompute(): void {
    const hot = this.cache.hot(HOT_K)
    const children = (u: string): string[] => this.cache.childDirs(u)
    const interests: Interest[] = this.owners.size > 0 ? [...this.owners.values()] : [NO_INTEREST]
    const items = new Map<string, { tier: Tier; full: boolean }>()
    const hotSet = new Set<string>()
    const ranges: Scope[] = []
    let indexTargets: Scope[] = []
    for (const i of interests) {
      const r = computeScope({
        roots: this.roots,
        focus: i.focus,
        visible: i.visible,
        offscreen: i.offscreen,
        tabs: i.tabs,
        hot,
        indexTargets: this.indexTargets,
        activeDepth: this.settings.activeDepth,
        children
      })
      for (const it of r.periodic) {
        const cur = items.get(it.uri)
        if (!cur || TIER_RANK[it.tier] < TIER_RANK[cur.tier]) {
          items.set(it.uri, { tier: it.tier, full: it.full || (cur?.full ?? false) })
        } else if (it.full) cur.full = true
      }
      for (const h of r.background.hot) hotSet.add(h)
      ranges.push(...r.background.ranges)
      indexTargets = r.background.indexTargets
    }

    const now = this.now()
    const next = new Map<string, PeriodicEntry>()
    for (const [uri, it] of items) {
      const prev = this.periodic.get(uri)
      const dir = this.cache.getDir(uri)
      const checkedAt = dir?.checkedAt ?? null
      const span = this.intervalFor(uri, it.tier, dir)
      // 新进入范围：按上次检查的时刻排期（刚检查过的不立即重复）；变近的目录不等原来更长的间隔。
      // 确认时刻晚于现在（系统时钟回拨）时按现在计算
      const due = checkedAt === null ? now : Math.min(checkedAt, now) + span
      next.set(uri, { ...it, next: prev ? Math.min(prev.next, due) : due, span })
    }
    this.periodic = next
    this.queue.setScopes({
      indexTargets,
      hot: [...hotSet].map((uri) => ({ uri, maxDepth: HOT_DEPTH })),
      ranges
    })
    this.scopeDirty = false
  }

  /** 定期确认的间隔：按层与位置；出错的目录（权限、超时）按远层的间隔重试 */
  private intervalFor(uri: string, tier: Tier, dir = this.cache.getDir(uri)): number {
    const t = dir !== undefined && dir.state !== 'ok' ? 'far' : tier
    return this.settings.interval[t][this.enumerator.location(uri)] * 1000
  }

  // ---- 后台队列 ----

  /** 每个位置组最多 1 个（与定期确认、探测共用后台名额）；返回下一次需要唤醒的时刻 */
  private pumpBackground(now: number): number {
    let wakeAt = Infinity
    for (const { group, sample } of this.queue.groupList()) {
      // 最长的休息：用户操作中加倍
      const longest = 2 * this.settings.backgroundGapMs[this.enumerator.location(sample)]
      const gate = gateAt(this.backgroundNextAt, group, now, longest)
      if (gate > now) {
        wakeAt = Math.min(wakeAt, gate)
        continue
      }
      // 名额被占用：释放时会再次 pump
      if (!this.canStart(sample, 'bg')) continue
      const c = this.queue.peek(group, {
        now,
        running: new Set(this.running.keys()),
        skip: (u) => this.running.has(u) || this.isOffline(u),
        usable: (sc) => !this.isOffline(sc.uri)
      })
      if (!c) {
        const retry = this.queue.retryAt(group)
        if (retry > now) wakeAt = Math.min(wakeAt, retry)
        continue
      }
      this.queue.take(group)
      this.start({ uri: c.uri, prio: 'background', full: c.full, waiters: [], bypass: false }, 'bg')
    }
    return wakeAt
  }

  private backgroundGap(uri: string, now: number): number {
    const gap = this.settings.backgroundGapMs[this.enumerator.location(uri)]
    return now - this.lastInterestChange < BUSY_MS ? gap * 2 : gap
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
   * 每组定期确认 / 后台队列 / 探测共用 1 个 + P0 1 个；本地合计不超过 LOCAL_LIMIT；总数不超过线程池。
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
    if (task.prio === 'background') {
      this.backgroundNextAt.set(this.groupKey(uri), now + this.backgroundGap(uri, now))
    }
    // 刚确认过：重新排期。只比较修改时间的确认不代替关注点的完整读取
    const item = this.periodic.get(uri)
    if (item && task.prio !== 'probe' && (task.full || !item.full)) {
      item.span = this.intervalFor(uri, item.tier)
      item.next = now + item.span
    }

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
      this.queue.clearMissing(uri)
      const t = this.now()
      if (task.prio === 'probe') return { ok: true, entries: null, at: t }

      const dir = this.cache.getDir(uri)
      const needList =
        task.full ||
        dir === undefined ||
        dir.listedAt === null ||
        dir.state !== 'ok' ||
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
        // 消失的子目录连同子树已从缓存删除：显示其中目录的标签另行通知（见 notifyRemoved）
        this.notifyRemoved(uri, (u) => u !== uri && this.cache.getDir(u) === undefined)
        // 子目录可能有增减：分层的对象要重算；后台队列可能有了新的没有信息的目录
        if (this.periodic.has(uri)) this.scopeDirty = true
        this.queue.markDirty(this.groupKey(uri))
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
    if (error.code === 'FS_NOT_A_DIRECTORY') {
      const dir = this.cache.getDir(uri)
      if (!dir) {
        this.queue.markMissing(uri)
        return
      }
      // 已经记为「不是目录」后再次出错（父目录仍把它列为目录）：不再强制父目录，否则
      // 「删除 → 强制父目录 → 列表重建该行 → 后台队列再选中」会无限循环；走通用错误分支（按间隔重试）
      if (!(dir.state === 'unreachable' && dir.errorCode === 'FS_NOT_A_DIRECTORY')) {
        // 目录被同名文件替换：删除该目录自身的缓存（含子目录），但不从父目录列表中删除这一项
        // （它仍然存在，只是变成了文件）；该目录的行保留为错误状态（带确认时刻，后台队列不立即重选），
        // 并对父目录排一次确认（force：不与刚完成的 P0 合并），类型随确认更正（变成文件的项由列表删除其行）
        this.cache.removeSubtree(uri)
        this.cache.setState(uri, 'unreachable', 'FS_NOT_A_DIRECTORY', this.now())
        this.scopeDirty = true
        const parent = this.rootUris.has(uri) ? null : (dir.parentUri ?? parentUri(uri))
        this.events.changed(parent ?? uri)
        this.notifyRemoved(uri, (u) => u !== parent)
        if (parent !== null) this.requestP0(parent, { force: true })
        return
      }
    }
    if (error.code === 'FS_NOT_FOUND') {
      const dir = this.cache.getDir(uri)
      if (!dir) {
        // 没有缓存行的目录不存在（例如不存在的建立索引目标）：后台队列不再把它当作起点反复读取
        this.queue.markMissing(uri)
        return
      }
      const parent = this.rootUris.has(uri) ? null : (dir.parentUri ?? parentUri(uri))
      // 已经记为「不存在」后再次出错：该行还在，说明父目录的真实列表仍把它列为目录（否则父目录的确认
      // 会删除这一行）。不再强制父目录、不再从父目录列表中删除，否则「强制父目录 → 列表仍有它 →
      // 再读取它」会循环；只更新状态与确认时刻（出错的目录按远层间隔重试）
      if (parent !== null && dir.state === 'not-found') {
        this.cache.setState(uri, 'not-found', error.code, this.now())
        return
      }
      // 连同父目录缓存列表中的该项一起删除：父目录刚确认过（fresh）时，树与搜索也不再显示它。
      // 但这只是推断（例如上级目录改名期间读取，随即改回）：removeMissing 让父目录的修改时间比较失效，
      // 并对父目录排一次确认（force：不与刚完成的 P0 合并），由真实列表决定父目录的内容
      this.cache.removeMissing(uri)
      this.scopeDirty = true
      this.events.changed(parent ?? uri)
      this.notifyRemoved(uri, (u) => u !== (parent ?? uri))
      if (parent !== null) {
        // 行保留为「不存在」（带确认时刻）：父目录的确认若仍列出它，下次出错不再强制父目录
        this.cache.setState(uri, 'not-found', error.code, this.now())
        this.requestP0(parent, { force: true })
      }
      return
    }
    // 失败的时刻记为确认时刻（checked_at）：后台队列不会立即重选它
    const state = error.code === 'FS_PERMISSION_DENIED' ? 'denied' : 'unreachable'
    const { changed } = this.cache.setState(uri, state, error.code, this.now())
    if (changed) this.events.changed(uri)
  }

  /**
   * 缓存中 uri 及其子树被删除（目录不在了）：按关注点处理的目录（各窗口的选中目录与标签中显示的目录）
   * 中等于 uri 或在其之下、且满足 pick 的，各通知一次 changed。显示它们的目录视图只订阅自身的
   * vfs.changed，据此重新列出并得到「找不到」；只通知父目录时它们收不到任何事件。
   * 之后对这些目录的读取再失败（没有缓存行，或行已记为「不存在」）不再通知，不会形成
   * 「通知 → 重新列出 → 失败 → 通知」的循环
   */
  private notifyRemoved(uri: string, pick: (u: string) => boolean): void {
    const seen = new Set<string>()
    for (const o of this.owners.values()) {
      for (const u of focusUris(o)) {
        if (seen.has(u) || !isUnderUri(u, uri) || !pick(u)) continue
        seen.add(u)
        this.events.changed(u)
      }
    }
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
      this.queue.invalidate()
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
    this.queue.invalidate()
    this.events.reachability(share, 'online', this.now())
    for (const o of this.owners.values()) {
      for (const u of focusUris(o)) if (this.enumerator.shareKey(u) === share) this.requestP0(u)
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
