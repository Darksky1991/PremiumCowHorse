import type { DesktopCollector, DesktopItem } from '@pch/shared'
import type { Logger } from '../../infra/logger'
import type { Collector } from './collectors/types'
import type { LiveState } from './live-state'
import { collectorOf, windowsSignature, type ListWindows, type WindowInfo } from './window-list'

export interface MonitorTimings {
  /** 窗口枚举间隔 */
  pollMs: number
  /** 标题 / 窗口集合变化后到采集的防抖 */
  debounceMs: number
  /** 按类别覆盖防抖（VS Code 标题随编辑频繁变化，需更长） */
  debounceOverrides: Partial<Record<DesktopCollector, number>>
  /** 全部类别完整读取的兜底间隔 */
  fullRefreshMs: number
  /** 单次采集的超时 */
  collectorTimeoutMs: number
}

export interface DesktopMonitorDeps {
  listWindows: ListWindows
  collectors: Collector[]
  live: LiveState
  timings: MonitorTimings
  now: () => number
  logger: Logger
  onChange: () => void
}

type Outcome = { ok: true; items: DesktopItem[] } | { ok: false; error: unknown }

const firstLine = (e: unknown): string => {
  const msg = e instanceof Error ? e.message : String(e)
  return msg.split(/\r?\n/)[0] ?? ''
}

/**
 * 监控编排：定时枚举窗口，按类别比较签名，有变化的类别防抖后调用该类采集器，
 * 结果交给 LiveState（设计 5.2–5.4）。采集器失败不影响该类已有结果。
 */
export class DesktopMonitor {
  private readonly d: DesktopMonitorDeps
  /** 上一轮各类别的签名；null = 该类没有窗口；缺项 = 还没枚举过 */
  private readonly lastSig = new Map<DesktopCollector, string | null>()
  private windows: WindowInfo[] = []
  private readonly debounce = new Map<DesktopCollector, ReturnType<typeof setTimeout>>()
  private readonly inflight = new Map<DesktopCollector, Promise<void>>()
  private readonly rerun = new Set<DesktopCollector>()
  private readonly failed = new Set<DesktopCollector>()
  private pollTimer: ReturnType<typeof setInterval> | undefined
  private fullTimer: ReturnType<typeof setInterval> | undefined
  private stopped = false
  private listFailing = false

  constructor(deps: DesktopMonitorDeps) {
    this.d = deps
  }

  start(): void {
    if (this.pollTimer) return
    this.stopped = false
    this.pollTimer = setInterval(() => this.poll(), this.d.timings.pollMs)
    this.fullTimer = setInterval(() => {
      for (const c of this.d.collectors) {
        this.cancelDebounce(c.id)
        void this.collect(c.id)
      }
    }, this.d.timings.fullRefreshMs)
  }

  stop(): void {
    this.stopped = true
    clearInterval(this.pollTimer)
    clearInterval(this.fullTimer)
    this.pollTimer = this.fullTimer = undefined
    for (const t of this.debounce.values()) clearTimeout(t)
    this.debounce.clear()
  }

  /** 立即对全部类别完整读取一次并等待完成（含失败），不抛错 */
  async refreshAll(): Promise<void> {
    if (this.stopped) return
    // 枚举失败时窗口列表不可信：不采集（不 apply、不 markFailed），各类视同本轮未采集
    if (this.enumerate() === null) return
    // 马上要采集，不必再等已排队的防抖
    for (const c of this.d.collectors) this.cancelDebounce(c.id)
    await Promise.all(this.d.collectors.map((c) => this.collect(c.id)))
  }

  /** 最近一次采集失败的类别 */
  unreadable(): DesktopCollector[] {
    return [...this.failed]
  }

  /** 枚举并更新签名，返回有变化的类别；枚举抛错时记一次 warn 并返回 null（沿用上一轮数据） */
  private enumerate(): DesktopCollector[] | null {
    let ws: WindowInfo[]
    try {
      ws = this.d.listWindows()
    } catch (e) {
      if (!this.listFailing) this.d.logger.warn(`desktop: listWindows failed: ${firstLine(e)}`)
      this.listFailing = true
      return null
    }
    this.listFailing = false
    this.windows = ws
    const sigs = windowsSignature(ws)
    const changed: DesktopCollector[] = []
    for (const c of this.d.collectors) {
      const cur = sigs.get(c.id) ?? null
      const prev = this.lastSig.get(c.id)
      this.lastSig.set(c.id, cur)
      // 首次就没有窗口：无事可做；有窗口消失（有 → 无）要采一次，让 LiveState 开始计时
      if (cur !== prev && !(prev === undefined && cur === null)) changed.push(c.id)
    }
    return changed
  }

  private poll(): void {
    if (this.stopped) return
    const changed = this.enumerate()
    if (!changed) return
    for (const id of changed) {
      // 从第一次变化起计时，不重置：持续变化的类别（VS Code 标题）也能按时采集；
      // 到期时用当时最新的窗口列表
      if (this.debounce.has(id)) continue
      const ms = this.d.timings.debounceOverrides[id] ?? this.d.timings.debounceMs
      this.debounce.set(
        id,
        setTimeout(() => {
          this.debounce.delete(id)
          if (!this.stopped) void this.collect(id)
        }, ms)
      )
    }
  }

  private cancelDebounce(id: DesktopCollector): void {
    const t = this.debounce.get(id)
    if (t) clearTimeout(t)
    this.debounce.delete(id)
  }

  /** 同一类别同时只有一个采集；进行中又有请求时，结束后再补一次 */
  private collect(id: DesktopCollector): Promise<void> {
    const running = this.inflight.get(id)
    if (running) {
      this.rerun.add(id)
      return running
    }
    const p = this.loop(id).finally(() => this.inflight.delete(id))
    this.inflight.set(id, p)
    return p
  }

  private async loop(id: DesktopCollector): Promise<void> {
    do {
      this.rerun.delete(id)
      await this.once(id)
    } while (this.rerun.has(id) && !this.stopped)
  }

  private async once(id: DesktopCollector): Promise<void> {
    const collector = this.d.collectors.find((c) => c.id === id)
    if (!collector) return
    const mine = this.windows.filter((w) => collectorOf(w) === id)
    let timer: ReturnType<typeof setTimeout> | undefined
    const run: Promise<Outcome> = (async () => collector.collect(mine))().then(
      (items): Outcome => ({ ok: true, items }),
      (error: unknown): Outcome => ({ ok: false, error })
    )
    const timeout = new Promise<Outcome>((resolve) => {
      timer = setTimeout(
        () =>
          resolve({
            ok: false,
            error: new Error(`collector timed out after ${this.d.timings.collectorTimeoutMs} ms`)
          }),
        this.d.timings.collectorTimeoutMs
      )
    })
    // 超时后迟到的结果因 race 已决出而被丢弃
    const out = await Promise.race([run, timeout])
    clearTimeout(timer)
    if (this.stopped) return

    let changed = false
    if (out.ok) {
      if (this.failed.delete(id)) {
        this.d.logger.info(`desktop: collector ${id} recovered`)
        changed = true
      }
      if (this.d.live.apply(id, out.items, this.d.now())) changed = true
    } else {
      this.d.live.markFailed(id)
      if (!this.failed.has(id)) {
        this.failed.add(id)
        this.d.logger.warn(`desktop: collector ${id} failed: ${firstLine(out.error)}`)
        changed = true
      }
    }
    if (changed) this.notify()
  }

  private notify(): void {
    try {
      this.d.onChange()
    } catch (e) {
      this.d.logger.error(`desktop: onChange threw: ${firstLine(e)}`)
    }
  }
}
