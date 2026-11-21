import {
  AppError,
  openTargetsOf,
  type DesktopCurrent,
  type DesktopItem,
  type DesktopRestoreResult,
  type DesktopSnapshot,
  type DesktopSnapshotItem,
  type DesktopSnapshotKind,
  type DesktopSnapshotSummary,
  type IpcEvents
} from '@pch/shared'
import type { Logger } from '../../infra/logger'
import type { LiveState } from './live-state'
import type { DesktopMonitor } from './monitor'
import { itemsToOffer, pickRestoreCandidate } from './restore-candidate'
import type { DesktopSnapshotRepo } from './snapshot.repo'

/** 服务用到的监控接口（测试可替换） */
export type DesktopMonitorLike = Pick<
  DesktopMonitor,
  'start' | 'stop' | 'refreshAll' | 'unreadable'
>

export interface DesktopServiceDeps {
  repo: DesktopSnapshotRepo
  /** null：不监控（非 Windows、koffi 加载失败）；查询照常返回空结果 */
  monitor: DesktopMonitorLike | null
  live: LiveState
  restore: (items: DesktopSnapshotItem[], open: Set<string>) => Promise<DesktopRestoreResult>
  logonAt: () => Promise<number>
  now: () => number
  emit: (e: IpcEvents['desktop.changed']) => void
  autoSaveMs: number
  keepAuto: number
  keepLogons: number
  /** query-session-end 后冻结现场、暂停自动保存的时长（设计 5.3） */
  sessionFreezeMs: number
  logger: Logger
}

const firstLine = (e: unknown): string =>
  (e instanceof Error ? e.message : String(e)).split(/\r?\n/)[0] ?? ''

/** 内容签名（与顺序无关）：retained 与最近一份 auto 是否相同 */
const signatureOf = (items: DesktopItem[]): string =>
  items
    .map((i) => JSON.stringify(i))
    .sort()
    .join('\n')

const countsOf = (items: DesktopItem[]): string => {
  const counts = new Map<string, number>()
  for (const i of items) counts.set(i.kind, (counts.get(i.kind) ?? 0) + 1)
  return counts.size === 0 ? 'none' : [...counts].map(([k, n]) => `${k}=${n}`).join(' ')
}

/**
 * 桌面记录服务（设计 5.3–5.5）：启动时取登录时刻与恢复候选，驱动监控，定时写自动记录；
 * 手动 / 退出时保存、会话结束处理、恢复的入口。所有写入串行执行，stop 后 idle() 等待写完
 */
export class DesktopService {
  private readonly d: DesktopServiceDeps
  private startPromise: Promise<void> | null = null
  private logon: number | undefined
  /** start 时记下的恢复候选（在写任何本次快照之前）；restorePrompt 取走后为 null */
  private candidate: { snapshotId: number } | null = null
  /** 第一次完整读取已完成：之前的现场不完整，不写自动记录 */
  private ready = false
  private stopped = false
  private timer: ReturnType<typeof setInterval> | undefined
  /** 本次登录最近一份 auto 的内容签名 */
  private lastAutoSig: string | null = null
  /** 自动保存暂停到这一刻（会话结束期间冻结） */
  private pausedUntil = 0
  private writes: Promise<unknown> = Promise.resolve()
  private restores: Promise<unknown> = Promise.resolve()

  constructor(deps: DesktopServiceDeps) {
    this.d = deps
  }

  /** 是否在监控（否则退出时不拦截、不写快照） */
  get enabled(): boolean {
    return this.d.monitor !== null
  }

  /**
   * 取登录时刻 → 记下恢复候选 → 启动监控并完整读取一次 → 写本次登录的第一份 auto →
   * 每 autoSaveMs 检查一次（retained 与最近一份 auto 不同才写，写后清理）
   */
  start(): Promise<void> {
    this.startPromise ??= this.doStart()
    return this.startPromise
  }

  private async doStart(): Promise<void> {
    const startedAt = this.d.now()
    try {
      this.logon = await this.d.logonAt()
    } catch (e) {
      // 取不到登录时刻：用应用启动时刻（同一次登录中重启本应用会被当作新的登录，恢复提示可能不准）
      this.logon = startedAt
      this.d.logger.warn(
        `desktop: cannot read the logon time, using the app start time: ${firstLine(e)}`
      )
    }
    const monitor = this.d.monitor
    if (!monitor) {
      this.d.logger.info('desktop: monitoring disabled on this platform')
      return
    }
    try {
      this.candidate = pickRestoreCandidate(await this.d.repo.listByLogon(), this.logon)
    } catch (e) {
      // 取不到候选只影响恢复提示，监控照常启动
      this.d.logger.warn(`desktop: cannot pick the restore candidate: ${firstLine(e)}`)
      this.candidate = null
    }
    if (this.stopped) return
    monitor.start()
    if (await monitor.refreshAll()) {
      if (this.stopped) return
      this.ready = true
      const items = this.d.live.retained(this.d.now())
      await this.enqueue(() => this.writeAuto(items))
    } else {
      // 窗口枚举失败：现场不完整，第一份 auto 等之后第一次成功的完整读取（tick 中重试）
      this.d.logger.info('desktop: first full read failed; the first auto snapshot is deferred')
    }
    if (this.stopped) return
    this.timer = setInterval(() => this.tick(), this.d.autoSaveMs)
    const unreadable = monitor.unreadable()
    this.d.logger.info(
      `desktop: monitoring started (logon ${new Date(this.logon).toISOString()}; current: ${countsOf(
        this.d.live.current().map((c) => c.item)
      )}; unreadable: ${unreadable.length === 0 ? 'none' : unreadable.join(',')})`
    )
  }

  /** start 时记下的候选 → 滤掉已开着的项目；只返回一次（之后为 null）；没有可提示的项目 → null */
  async restorePrompt(): Promise<DesktopSnapshot | null> {
    await this.startPromise?.catch(() => undefined)
    const candidate = this.candidate
    this.candidate = null
    if (!candidate) return null
    const snapshot = await this.d.repo.get(candidate.snapshotId)
    if (!snapshot) return null
    const items = itemsToOffer(snapshot, this.openTargets())
    return items.length === 0 ? null : { ...snapshot, items }
  }

  list(): Promise<DesktopSnapshotSummary[]> {
    return this.d.repo.list()
  }

  async get(id: number): Promise<DesktopSnapshot> {
    const snapshot = await this.d.repo.get(id)
    if (!snapshot) throw new AppError({ code: 'DESKTOP_SNAPSHOT_NOT_FOUND', detail: String(id) })
    return snapshot
  }

  current(): DesktopCurrent {
    return { items: this.d.live.current(), unreadable: this.d.monitor?.unreadable() ?? [] }
  }

  /** 手动快照：当前现场中 key 在列表里的项目 */
  async saveManual(keys: string[], name: string | null): Promise<number> {
    const id = await this.enqueue(() => this.insert('manual', this.pick(keys), name))
    this.d.emit({ scope: 'snapshots' })
    return id
  }

  /** 退出时：save → exit（勾选的项目）；否则 exit-none（下次登录不提示，设计第 8 节） */
  async saveExit(save: boolean, keys: string[]): Promise<void> {
    const items = save ? this.pick(keys) : []
    const id = await this.enqueue(() => this.insert(save ? 'exit' : 'exit-none', items, null))
    this.d.logger.info(
      `desktop: ${save ? 'exit' : 'exit-none'} snapshot #${id} (${countsOf(items)})`
    )
    this.d.emit({ scope: 'snapshots' })
  }

  /** 会话结束用：立即写 retained，不比较（第一次完整读取之前现场不完整，不写） */
  async saveAutoNow(): Promise<void> {
    if (!this.ready) return
    await this.enqueue(() => this.writeAuto(this.d.live.retained(this.d.now())))
  }

  /**
   * query-session-end：冻结现场（不再移除项目）并暂停自动保存 sessionFreezeMs，
   * 立即写一份自动记录。到期仍在运行 = 关机被取消，自动恢复（设计 5.3）
   */
  async querySessionEnd(): Promise<void> {
    if (!this.d.monitor) return
    const now = this.d.now()
    const until = now + this.d.sessionFreezeMs
    this.d.live.freeze(until, now)
    this.pausedUntil = Math.max(this.pausedUntil, until)
    await this.saveAutoNow()
  }

  /** session-end：会话确实结束，停止监控与自动保存 */
  sessionEnded(): void {
    this.stop()
  }

  async rename(id: number, name: string | null): Promise<void> {
    await this.enqueue(() => this.d.repo.rename(id, name))
    this.d.emit({ scope: 'snapshots' })
  }

  async delete(id: number): Promise<void> {
    await this.enqueue(() => this.d.repo.delete(id))
    this.d.emit({ scope: 'snapshots' })
  }

  /** 只恢复属于该快照的项目（按快照中的顺序；不属于的 id 忽略）；已开着的判断用当前现场 */
  async restore(snapshotId: number, itemIds: number[]): Promise<DesktopRestoreResult> {
    const snapshot = await this.get(snapshotId)
    const wanted = new Set(itemIds)
    const items = snapshot.items.filter((i) => wanted.has(i.id))
    // 多次恢复依次执行：后一次按前一次结束时的现场判断「已开着」
    const run = this.restores.then(() => this.d.restore(items, this.openTargets()))
    this.restores = run.catch(() => undefined)
    return run
  }

  /** 停止监控与自动保存；进行中的写入用 idle() 等待 */
  stop(): void {
    this.stopped = true
    clearInterval(this.timer)
    this.timer = undefined
    this.d.monitor?.stop()
  }

  /** 等待已排队的写入全部结束（不抛错） */
  async idle(): Promise<void> {
    await this.writes.catch(() => undefined)
  }

  private tick(): void {
    if (this.stopped || this.d.now() < this.pausedUntil) return
    this.autoSave().catch((e: unknown) =>
      this.d.logger.error(`desktop: auto save failed: ${firstLine(e)}`)
    )
  }

  private async autoSave(): Promise<void> {
    if (!this.ready) {
      // 启动时的完整读取失败过：先再完整读取一次，成功后才开始写自动记录
      const monitor = this.d.monitor
      if (!monitor || !(await monitor.refreshAll()) || this.stopped) return
      this.ready = true
    }
    await this.enqueue(async () => {
      const items = this.d.live.retained(this.d.now())
      if (signatureOf(items) !== this.lastAutoSig) await this.writeAuto(items)
    })
  }

  private async writeAuto(items: DesktopItem[]): Promise<void> {
    const id = await this.insert('auto', items, null)
    this.lastAutoSig = signatureOf(items)
    await this.d.repo.prune(this.d.keepAuto, this.d.keepLogons)
    this.d.logger.info(`desktop: auto snapshot #${id} (${countsOf(items)})`)
    this.d.emit({ scope: 'snapshots' })
  }

  private insert(
    kind: DesktopSnapshotKind,
    items: DesktopItem[],
    name: string | null
  ): Promise<number> {
    return this.d.repo.insert({
      kind,
      createdAt: this.d.now(),
      logonAt: this.logon ?? this.d.now(),
      name,
      items
    })
  }

  private pick(keys: string[]): DesktopItem[] {
    const wanted = new Set(keys)
    return this.d.live
      .current()
      .filter((c) => wanted.has(c.key))
      .map((c) => c.item)
  }

  private openTargets(): Set<string> {
    return openTargetsOf(this.d.live.current().map((c) => c.item))
  }

  /** 写入串行化：一次失败不影响后续 */
  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const p = this.writes.then(fn)
    this.writes = p.catch(() => undefined)
    return p
  }
}
