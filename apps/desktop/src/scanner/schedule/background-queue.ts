import type { Cache, Scope } from '../cache/cache'

/** ①②③ 每类候选一次从缓存取出的个数 */
export const BATCH_SIZE = 50
/**
 * ④（全部范围内最久没确认的）一次取出的个数。范围是整卷而层数上限很小时这个查询最慢
 * （30 万行约 25ms：按确认时刻的索引顺序扫描、逐行过滤层数），一次多取一些，平摊到每次选择约 0.1ms。
 * 内存中每个位置组至多保存 BATCH_SIZE + OLDEST_BATCH_SIZE（加上各范围的起点）个候选。
 */
export const OLDEST_BATCH_SIZE = 200
/** 热点目录进入后台范围的层数：热点目录本身与其子目录 */
export const HOT_DEPTH = 1

export interface QueueScopes {
  indexTargets: Scope[]
  hot: Scope[]
  ranges: Scope[]
}

export interface Candidate {
  uri: string
  /** true=没有信息，完整读取；false=比较目录修改时间 */
  full: boolean
}

interface Item {
  uri: string
  /** unlisted：取出时从未尝试读取；checked：取出时按确认时刻最久的 */
  kind: 'unlisted' | 'checked'
  /** 范围的起点在缓存中还没有行（父目录从未读过）：第一次由它开始 */
  seed: boolean
}

interface Group {
  key: string
  index: Scope[]
  hot: Scope[]
  /** 全部范围（建立索引 + 热点 + 积极 / 全部），同一 URI 取更大的层数 */
  all: Scope[]
  batch: Item[]
  cursor: number
  mode: Item['kind'] | null
  fetchedAt: number
  /** 一次取出后没有可用的候选：此时刻之前不再查询（有新信息时提前） */
  retryAt: number
  /** 有目录的列表变化（可能出现了新的没有信息的目录） */
  dirty: boolean
  /** 已作为起点尝试过的范围（范围变化时重置）：起点读取失败、缓存中仍没有行时不反复尝试 */
  seeded: Set<string>
}

export interface NextOptions {
  now: number
  /** 正在进行的检查（查询时排除） */
  running: ReadonlySet<string>
  /** 不能现在确认的目录（正在进行、共享断开） */
  skip: (uri: string) => boolean
  /** 范围是否可用（共享断开的范围不查询） */
  usable: (scope: Scope) => boolean
}

function mergeScopes(list: Scope[]): Scope[] {
  const m = new Map<string, number | null>()
  for (const s of list) {
    if (!m.has(s.uri)) {
      m.set(s.uri, s.maxDepth)
      continue
    }
    const cur = m.get(s.uri) ?? null
    m.set(s.uri, cur === null || s.maxDepth === null ? null : Math.max(cur, s.maxDepth))
  }
  return [...m]
    .map(([uri, maxDepth]) => ({ uri, maxDepth }))
    .sort((a, b) => (a.uri < b.uri ? -1 : a.uri > b.uri ? 1 : 0))
}

/**
 * 后台缓存队列的候选（设计 8.2）。按位置组（本地卷 / 网络主机）分别从缓存中按优先级批量取候选，
 * 在内存中逐个消费；用完或范围变化时重新取。不在内存中展开整棵树：每组至多保存几批候选。
 *
 * 优先级：① 建立索引中没有信息的 → ② 全部范围内没有信息的 → ③ 热点中最久没确认的 →
 * ④ 全部范围内最久没确认的。①② 有候选时只取 ①②（没有信息的目录终会读完，不会饿死 ③④）；
 * ③④ 放在同一批中先 ③ 后 ④（否则热点永远「最久没确认」，④ 永远轮不到）。
 * 读取失败的目录以失败时刻为确认时刻（Cache.setState），自然排到后面，不会被立即重选。
 */
export class BackgroundQueue {
  private readonly groups = new Map<string, Group>()

  constructor(
    private readonly deps: {
      cache: Cache
      groupKey: (uri: string) => string
      /** 刚确认过（此时长内）的目录不再选 */
      freshMs: number
    }
  ) {}

  /** 范围整体替换；范围没有变化的组保留当前的候选 */
  setScopes(scopes: QueueScopes): void {
    const parts = new Map<string, { index: Scope[]; hot: Scope[]; all: Scope[] }>()
    const part = (s: Scope): { index: Scope[]; hot: Scope[]; all: Scope[] } => {
      const k = this.deps.groupKey(s.uri)
      let p = parts.get(k)
      if (!p) {
        p = { index: [], hot: [], all: [] }
        parts.set(k, p)
      }
      return p
    }
    for (const s of scopes.indexTargets) part(s).index.push(s)
    for (const s of scopes.hot) part(s).hot.push(s)
    for (const s of [...scopes.indexTargets, ...scopes.hot, ...scopes.ranges]) part(s).all.push(s)

    for (const k of [...this.groups.keys()]) if (!parts.has(k)) this.groups.delete(k)
    for (const [k, p] of parts) {
      const index = mergeScopes(p.index)
      const hot = mergeScopes(p.hot)
      const all = mergeScopes(p.all)
      const key = JSON.stringify([index, hot, all])
      if (this.groups.get(k)?.key === key) continue
      this.groups.set(k, {
        key,
        index,
        hot,
        all,
        batch: [],
        cursor: 0,
        mode: null,
        fetchedAt: 0,
        retryAt: 0,
        dirty: false,
        seeded: new Set()
      })
    }
  }

  /** 有后台范围的位置组与组内任一范围的 URI（调度器用它判断并发名额） */
  groupList(): { group: string; sample: string }[] {
    return [...this.groups].map(([group, g]) => ({ group, sample: g.all[0]!.uri }))
  }

  /** 组内有目录的列表发生了变化：可能出现了新的没有信息的目录 */
  markDirty(group: string): void {
    const g = this.groups.get(group)
    if (!g) return
    g.dirty = true
    g.retryAt = 0
  }

  /** 丢弃所有候选（共享断开 / 恢复：可用的范围变化） */
  invalidate(): void {
    for (const g of this.groups.values()) {
      g.batch = []
      g.cursor = 0
      g.mode = null
      g.retryAt = 0
    }
  }

  /** 没有可用候选时下一次查询的时刻（0 = 随时） */
  retryAt(group: string): number {
    return this.groups.get(group)?.retryAt ?? 0
  }

  /** 内存中的候选数（所有组） */
  size(): number {
    let n = 0
    for (const g of this.groups.values()) n += g.batch.length - g.cursor
    return n
  }

  /** 组内的下一个候选（不移出；启动后调用 take）。需要时从缓存取一批；没有可用候选返回 null */
  peek(group: string, opts: NextOptions): Candidate | null {
    const g = this.groups.get(group)
    if (!g) return null
    if (g.dirty && g.mode === 'checked') {
      // 正在确认已知目录时出现了新目录：没有信息的优先，换成新的一批
      const fresh = this.fetchUnlisted(g, opts)
      g.dirty = false
      if (fresh.length > 0) this.load(g, fresh, 'unlisted', opts.now)
    }
    let fetched = false
    for (;;) {
      if (g.cursor >= g.batch.length) {
        // 每次调用最多查询一次：取出的候选全都不可用时等 retryAt
        if (fetched || opts.now < g.retryAt) return null
        fetched = true
        this.fetch(g, opts)
        if (g.batch.length === 0) {
          g.retryAt = opts.now + this.deps.freshMs
          return null
        }
        continue
      }
      const it = g.batch[g.cursor]!
      if (this.stale(g, it, opts.now) || opts.skip(it.uri)) {
        g.cursor += 1
        if (g.cursor >= g.batch.length && fetched) g.retryAt = opts.now + this.deps.freshMs
        continue
      }
      return { uri: it.uri, full: it.kind === 'unlisted' }
    }
  }

  take(group: string): void {
    const g = this.groups.get(group)
    if (g && g.cursor < g.batch.length) g.cursor += 1
  }

  // ---- 内部 ----

  /** 取出后已不适用：没有信息的已有了信息（或已被删除）；最久没确认的在取出后（或刚刚）被确认过 */
  private stale(g: Group, it: Item, now: number): boolean {
    const d = this.deps.cache.getDir(it.uri)
    if (it.kind === 'unlisted') return d === undefined ? !it.seed : d.checkedAt !== null
    if (d === undefined || d.checkedAt === null) return true
    return d.checkedAt >= g.fetchedAt || now - d.checkedAt < this.deps.freshMs
  }

  private load(g: Group, items: Item[], mode: Item['kind'], now: number): void {
    g.batch = items
    g.cursor = 0
    g.mode = mode
    g.fetchedAt = now
  }

  /** 查询全部完成后才修改状态：查询抛出异常时组的状态不变，下次重试 */
  private fetch(g: Group, opts: NextOptions): void {
    const unlisted = this.fetchUnlisted(g, opts)
    g.dirty = false
    if (unlisted.length > 0) {
      this.load(g, unlisted, 'unlisted', opts.now)
      return
    }
    const hot = g.hot.filter(opts.usable)
    const all = g.all.filter(opts.usable)
    const running = new Set(opts.running)
    const uris = [
      ...(hot.length > 0 ? this.deps.cache.oldestChecked(hot, BATCH_SIZE, running) : []),
      ...(all.length > 0 ? this.deps.cache.oldestChecked(all, OLDEST_BATCH_SIZE, running) : [])
    ]
    const items = [...new Set(uris)].map((uri): Item => ({ uri, kind: 'checked', seed: false }))
    this.load(g, items, 'checked', opts.now)
  }

  /** ① 建立索引中没有信息的（含没有行的起点）→ ② 全部范围内没有信息的 */
  private fetchUnlisted(g: Group, opts: NextOptions): Item[] {
    const index = g.index.filter(opts.usable)
    const all = g.all.filter(opts.usable)
    const n = BATCH_SIZE
    const running = new Set(opts.running)
    const seeds = (list: Scope[]): string[] =>
      list
        .filter((s) => !g.seeded.has(s.uri) && this.deps.cache.getDir(s.uri) === undefined)
        .map((s) => s.uri)
    const indexSeeds = seeds(index)
    const first = index.length > 0 ? this.deps.cache.nextUnlisted(index, n, running) : []
    const allSeeds = seeds(all)
    const second = all.length > 0 ? this.deps.cache.nextUnlisted(all, n, running) : []

    const out = new Map<string, Item>()
    for (const uri of indexSeeds) out.set(uri, { uri, kind: 'unlisted', seed: true })
    for (const uri of first) if (!out.has(uri)) out.set(uri, { uri, kind: 'unlisted', seed: false })
    for (const uri of allSeeds)
      if (!out.has(uri)) out.set(uri, { uri, kind: 'unlisted', seed: true })
    for (const uri of second)
      if (!out.has(uri)) out.set(uri, { uri, kind: 'unlisted', seed: false })
    for (const it of out.values()) if (it.seed) g.seeded.add(it.uri)
    return [...out.values()]
  }
}
