import { desktopItemKey, type DesktopCollector, type DesktopItem } from '@pch/shared'

interface Entry {
  item: DesktopItem
  /** 开始消失的时刻；undefined 表示此刻开着 */
  goneAt?: number
}

/**
 * 当前现场：按采集器类别保存最近一次结果。
 * 消失的项目要持续消失 removeAfterMs 才从 retained 中移除（关机时本应用几秒内被结束，
 * 等不到移除，关机前的全部项目因此留在自动记录里，设计 5.3）
 */
export class LiveState {
  private readonly removeAfterMs: number
  private readonly byCollector = new Map<DesktopCollector, Map<string, Entry>>()
  private frozenUntil = 0
  private lastNow = 0

  constructor(opts: { removeAfterMs: number }) {
    this.removeAfterMs = opts.removeAfterMs
  }

  /** 用某一类采集器的最新结果替换该类；返回现场（current 或 retained）是否变化 */
  apply(collector: DesktopCollector, items: DesktopItem[], now: number): boolean {
    // 与上一次 apply 时的现场比较：到期移除也算变化
    const before = this.signature(this.lastNow)
    this.lastNow = now
    const old = this.byCollector.get(collector) ?? new Map<string, Entry>()
    const next = new Map<string, Entry>()
    // 本轮开着的：新增或刷新内容，取消计时
    for (const item of items) next.set(desktopItemKey(item), { item })
    // 本轮没有的：保留并开始（或继续）计时；已过期的丢弃
    for (const [key, entry] of old) {
      if (next.has(key)) continue
      const goneAt = entry.goneAt ?? now
      if (this.expired(goneAt, now)) continue
      next.set(key, { item: entry.item, goneAt })
    }
    this.byCollector.set(collector, next)
    return before !== this.signature(now)
  }

  /** 该类本轮采集失败：不改动该类，也不开始移除计时 */
  markFailed(collector: DesktopCollector): void {
    void collector
  }

  /** 会话结束期间冻结：untilMs 之前不移除任何项目，之后按原规则重新计 removeAfterMs */
  freeze(untilMs: number): void {
    this.frozenUntil = Math.max(this.frozenUntil, untilMs)
  }

  /** 此刻开着的项目（不含消失中的） */
  current(): { key: string; item: DesktopItem }[] {
    const out: { key: string; item: DesktopItem }[] = []
    for (const map of this.byCollector.values()) {
      for (const [key, entry] of map) {
        if (entry.goneAt === undefined) out.push({ key, item: entry.item })
      }
    }
    return out
  }

  /** 自动保存用：开着的 + 消失未满 removeAfterMs 的 */
  retained(now: number): DesktopItem[] {
    const out: DesktopItem[] = []
    for (const map of this.byCollector.values()) {
      for (const entry of map.values()) {
        if (entry.goneAt === undefined || !this.expired(entry.goneAt, now)) out.push(entry.item)
      }
    }
    return out
  }

  /** 冻结期内的消失从冻结结束时才开始计时 */
  private expired(goneAt: number, now: number): boolean {
    return now - Math.max(goneAt, this.frozenUntil) >= this.removeAfterMs
  }

  private signature(now: number): string {
    const open = this.current()
      .map((c) => `${c.key}=${JSON.stringify(c.item)}`)
      .join('\n')
    const kept = this.retained(now)
      .map((i) => desktopItemKey(i))
      .join('\n')
    return `${open}\n--\n${kept}`
  }
}
