import {
  AppError,
  openTargetsOf,
  pickTabs,
  type DesktopCurrent,
  type DesktopItem,
  type DesktopPick,
  type DesktopRestorePick,
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
  /** 现场变化后到写自动快照的合并等待（短时间内多个类别相继变化只写一次） */
  changeSaveDelayMs: number
  /** 可见快照最多保留几个 */
  keepVisible: number
  /** 恢复完成后（无论是否清空快照），等这么久再重新扫描 */
  restoreRescanMs: number
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
  /** 本次启动时的恢复候选 id：本次运行期间不被清理（restorePrompt 取走 candidate 后仍保留） */
  private protectId: number | null = null
  /** 本次登录维护的那份 auto（原地更新）；被删除 / 清理后为 null 或失效，下次重新写入 */
  private autoId: number | null = null
  /**
   * autoId 那一行允许被原地更新的种类：通常只有 auto；start 时接回本次登录的 exit
   * （同一登录内重启本应用）时含 exit，第一次写入后回到只有 auto
   */
  private autoFrom: readonly DesktopSnapshotKind[] = ['auto']
  private rescanTimer: ReturnType<typeof setTimeout> | undefined
  private changeTimer: ReturnType<typeof setTimeout> | undefined
  /** 消失中项目到期（从 retained 移除）的时刻再写一次：不必等 autoSaveMs 的兜底 */
  private expiryTimer: ReturnType<typeof setTimeout> | undefined
  /** 第一次完整读取已完成：之前的现场不完整，不写自动记录 */
  private ready = false
  private stopped = false
  /** 退出流程已开始（saveExit）：之后不再自动保存、重新扫描，恢复后也不清空（退出快照不能被冲掉） */
  private closing = false
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
   * 之后现场每次变化（liveChanged，合并 changeSaveDelayMs）与每 autoSaveMs（兜底：消失项目到期移除不触发变化）
   * 检查一次：retained 与最近一份 auto 不同才写，写后清理
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
      const all = await this.d.repo.listByLogon()
      this.candidate = pickRestoreCandidate(all, this.logon)
      this.adoptOwnSnapshot(all, this.logon)
    } catch (e) {
      // 取不到候选只影响恢复提示，监控照常启动（auto 照常写入，可能多出一份）
      this.d.logger.warn(`desktop: cannot pick the restore candidate: ${firstLine(e)}`)
      this.candidate = null
    }
    this.protectId = this.candidate?.snapshotId ?? null
    if (this.stopped) return
    monitor.start()
    if (await monitor.refreshAll()) {
      if (this.stopped) return
      this.markReady()
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

  /**
   * 每次登录只占 1 个可见名额（Ruling 15）：同一登录内重启本应用时，接回本次登录已有的 auto
   * （没有时接回最新的 exit——上次退出时由 auto 改成的那份），之后原地更新它而不是再写一份
   */
  private adoptOwnSnapshot(all: DesktopSnapshotSummary[], logon: number): void {
    const own = all.filter((s) => s.logonAt === logon) // created_at 降序
    const auto = own.find((s) => s.kind === 'auto')
    const exit = own.find((s) => s.kind === 'exit')
    if (auto) {
      this.autoId = auto.id
      this.autoFrom = ['auto']
    } else if (exit) {
      this.autoId = exit.id
      this.autoFrom = ['auto', 'exit']
    }
  }

  /** 第一次完整读取完成：之后现场完整，可写自动记录与退出快照；通知渲染端（退出对话框据此结束加载态） */
  private markReady(): void {
    if (this.ready) return
    this.ready = true
    this.d.emit({ scope: 'current' })
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
    return {
      logonAt: this.logon ?? this.d.now(),
      ready: this.ready,
      items: this.d.live.current(),
      unreadable: this.d.monitor?.unreadable() ?? []
    }
  }

  /**
   * 监控报告现场变化（组合根接到 DesktopMonitor.onChange）：合并 changeSaveDelayMs 后按自动保存的规则写入，
   * 让自动快照尽量与现场同步。退出流程中、会话结束冻结期间、第一次完整读取之前不写
   */
  liveChanged(): void {
    if (this.stopped || this.closing || !this.ready || this.changeTimer) return
    this.changeTimer = setTimeout(() => {
      this.changeTimer = undefined
      this.tick()
    }, this.d.changeSaveDelayMs)
  }

  /** 手动快照：当前现场中选中的项目（Explorer 可只选部分标签） */
  async saveManual(picks: DesktopPick[], name: string | null): Promise<number> {
    const id = await this.enqueue(async () => {
      const newId = await this.insert('manual', this.pick(picks), name)
      await this.d.repo.prune(this.d.keepVisible, this.protectId)
      return newId
    })
    this.d.emit({ scope: 'snapshots' })
    return id
  }

  /**
   * 退出时（设计第 8 节、Ruling 15：每次登录只占 1 个可见名额）：
   * - save → 本次登录的 auto 原地改为 exit（种类、时间、项目换成勾选的项目）；没有 auto 时新写一份 exit。
   *   第一次完整读取之前现场不完整：不写 exit，本次登录已有的 auto 留作下次的恢复候选
   * - 不保存 → 删除本次登录的 auto，写 exit-none 标记（下次登录不提示）
   * 开始时即进入退出状态：之后的自动保存、重新扫描与恢复后的清空都不再进行
   */
  async saveExit(save: boolean, picks: DesktopPick[]): Promise<void> {
    this.closing = true
    clearTimeout(this.rescanTimer)
    this.rescanTimer = undefined
    clearTimeout(this.changeTimer)
    this.changeTimer = undefined
    clearTimeout(this.expiryTimer)
    this.expiryTimer = undefined
    if (save && !this.ready) {
      this.d.logger.info(
        'desktop: exit before the first full read; no exit snapshot (the auto snapshot is kept)'
      )
      return
    }
    const items = save ? this.pick(picks) : []
    const id = await this.enqueue(async () => {
      const autoId = this.autoId
      this.autoId = null
      this.autoFrom = ['auto']
      let newId: number
      if (save) {
        const converted =
          autoId !== null &&
          (await this.d.repo.convertToExit(autoId, { createdAt: this.d.now(), items }))
        newId = converted ? autoId : await this.insert('exit', items, null)
      } else {
        if (autoId !== null) await this.d.repo.deleteAuto(autoId)
        newId = await this.insert('exit-none', [], null)
      }
      await this.d.repo.prune(this.d.keepVisible, this.protectId)
      return newId
    })
    this.d.logger.info(
      `desktop: ${save ? 'exit' : 'exit-none'} snapshot #${id} (${countsOf(items)})`
    )
    this.d.emit({ scope: 'snapshots' })
  }

  /** 会话结束用：立即写 retained，不比较（第一次完整读取之前现场不完整，不写） */
  async saveAutoNow(): Promise<void> {
    // 退出流程中不写：会把已改成 exit 的那份之后再写出一份新的 auto，下次的恢复候选就不是 exit 了
    if (!this.ready || this.closing) return
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
    await this.enqueue(async () => {
      await this.d.repo.delete(id)
      if (id === this.autoId) this.autoId = null
    })
    this.d.emit({ scope: 'snapshots' })
  }

  /**
   * 只恢复属于该快照的项目（按快照中的顺序；不属于的 id 忽略；Explorer 按 tabs 只恢复部分标签，
   * 一个都不剩的忽略）；已开着的判断用当前现场。快照不在这里删除：恢复后由用户确认是否删除（clear）。
   * restoreRescanMs 后重新扫描一次
   */
  async restore(snapshotId: number, picks: DesktopRestorePick[]): Promise<DesktopRestoreResult> {
    const snapshot = await this.get(snapshotId)
    const wanted = new Map(picks.map((p) => [p.id, p.tabs]))
    const items: DesktopSnapshotItem[] = []
    for (const i of snapshot.items) {
      if (!wanted.has(i.id)) continue
      const item = pickTabs(i.item, wanted.get(i.id))
      if (item) items.push({ id: i.id, item })
    }
    // 多次恢复依次执行：后一次按前一次结束时的现场判断「已开着」
    const run = this.restores.then(() => this.d.restore(items, this.openTargets()))
    this.restores = run.catch(() => undefined)
    const result: DesktopRestoreResult = await run
    this.scheduleRescan()
    return result
  }

  /**
   * 删除全部快照（含 exit-none；恢复后经用户确认，设计第 9 节修订）：之后本次登录的 auto 重新写入
   * （第一次完整读取之后立即写一份现场）。退出流程中不做
   */
  async clear(): Promise<void> {
    if (this.closing) return
    await this.enqueue(async () => {
      if (this.closing) return
      await this.d.repo.deleteAll()
      this.autoId = null
      this.autoFrom = ['auto']
      this.protectId = null
      this.lastAutoSig = null
      if (this.ready && !this.stopped) await this.writeAuto(this.d.live.retained(this.d.now()))
    })
    this.d.logger.info('desktop: all snapshots deleted by the user')
    this.d.emit({ scope: 'snapshots' })
  }

  /** restoreRescanMs 后完整读取一次并写一份新的 auto；连续恢复时以最后一次为准，stop 时取消 */
  private scheduleRescan(): void {
    if (this.stopped || this.closing || !this.d.monitor) return
    clearTimeout(this.rescanTimer)
    this.rescanTimer = setTimeout(() => {
      this.rescan().catch((e: unknown) =>
        this.d.logger.error(`desktop: rescan after restore failed: ${firstLine(e)}`)
      )
    }, this.d.restoreRescanMs)
  }

  private async rescan(): Promise<void> {
    const monitor = this.d.monitor
    if (this.stopped || this.closing || !monitor) return
    // 枚举失败：现场不完整，不写；之后的自动保存 tick 会在读取成功后写（lastAutoSig 为 null）
    if (!(await monitor.refreshAll()) || this.stopped || this.closing) return
    this.markReady()
    await this.enqueue(async () => {
      if (!this.closing) await this.writeAuto(this.d.live.retained(this.d.now()))
    })
  }

  /** 停止监控与自动保存；进行中的写入用 idle() 等待 */
  stop(): void {
    this.stopped = true
    clearInterval(this.timer)
    this.timer = undefined
    clearTimeout(this.rescanTimer)
    this.rescanTimer = undefined
    clearTimeout(this.changeTimer)
    this.changeTimer = undefined
    clearTimeout(this.expiryTimer)
    this.expiryTimer = undefined
    this.d.monitor?.stop()
  }

  /** 等待已排队的写入全部结束（不抛错） */
  async idle(): Promise<void> {
    await this.writes.catch(() => undefined)
  }

  private tick(): void {
    if (this.stopped || this.closing || this.d.now() < this.pausedUntil) return
    this.autoSave().catch((e: unknown) =>
      this.d.logger.error(`desktop: auto save failed: ${firstLine(e)}`)
    )
  }

  private async autoSave(): Promise<void> {
    if (!this.ready) {
      // 启动时的完整读取失败过：先再完整读取一次，成功后才开始写自动记录
      const monitor = this.d.monitor
      if (!monitor || !(await monitor.refreshAll()) || this.stopped) return
      this.markReady()
    }
    await this.enqueue(async () => {
      if (this.closing) return
      const items = this.d.live.retained(this.d.now())
      if (signatureOf(items) !== this.lastAutoSig) await this.writeAuto(items)
      else this.scheduleExpiry()
    })
  }

  /** 按现场中最早的到期时刻安排下一次检查（每次检查 / 写入后重排） */
  private scheduleExpiry(): void {
    clearTimeout(this.expiryTimer)
    this.expiryTimer = undefined
    if (this.stopped || this.closing) return
    const now = this.d.now()
    const at = this.d.live.nextExpiry(now)
    if (at === null) return
    this.expiryTimer = setTimeout(() => {
      this.expiryTimer = undefined
      this.tick()
    }, at - now)
  }

  private async writeAuto(items: DesktopItem[]): Promise<void> {
    // 每次登录只维护一份 auto：已有就原地更新（项目与时间），被删除 / 清理了就重新写入
    let id = this.autoId
    const updated =
      id !== null &&
      (await this.d.repo.updateAuto(id, { createdAt: this.d.now(), items }, this.autoFrom))
    if (!updated) {
      id = await this.insert('auto', items, null)
      this.autoId = id
    }
    this.autoFrom = ['auto']
    this.lastAutoSig = signatureOf(items)
    this.scheduleExpiry()
    await this.d.repo.prune(this.d.keepVisible, this.protectId)
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

  /** 现场中选中的项目（按现场顺序；Explorer 按 tabs 取部分标签，一个都不剩的不要） */
  private pick(picks: DesktopPick[]): DesktopItem[] {
    const wanted = new Map(picks.map((p) => [p.key, p.tabs]))
    const out: DesktopItem[] = []
    for (const c of this.d.live.current()) {
      if (!wanted.has(c.key)) continue
      const item = pickTabs(c.item, wanted.get(c.key))
      if (item) out.push(item)
    }
    return out
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
