import type { Cache, Scope } from '../cache/cache'

/** ①②③ 每类候选一次从缓存取出的个数 */
export const BATCH_SIZE = 50
/**
 * ④（全部范围内最久没确认的）一次取出的个数。范围是整卷而层数上限很小时这个查询最慢（按确认时刻的
 * 索引顺序扫描、逐行过滤层数；30 万行合成数据：内存库约 15ms，文件库 limit 20 约 25ms、limit 200 约 45ms），
 * 一次多取一些来平摊。实测平摊到每次选择（含写回确认时刻）：范围内目录足够多时内存库约 0.04ms、
 * 文件库约 0.2ms；整卷 maxDepth 1 时内存库约 0.16ms，文件库约 2ms（范围内只有 51 个目录，
 * 一批取不满，选完后休眠到远层间隔）。数字与测量条件见 devDoc/2026-11-19-09。
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
  /** 范围的起点在缓存中还没有行（父目录从未读过）：由它开始 */
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
  /**
   * 一次取出后没有可用的候选：此时刻之前不再查询（最早一个目录重新符合条件的时刻；
   * Infinity = 等新的信息：列表变化、范围变化、共享恢复、配置变化）
   */
  retryAt: number
  /** 有目录的列表变化（可能出现了新的没有信息的目录） */
  dirty: boolean
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
 * 已确认过的目录在「远」层的间隔（minAgeMs）之内不再确认：范围很小时不会反复读同一个目录，
 * 没有可选目录时休眠到最早一个目录重新符合条件为止。
 */
export class BackgroundQueue {
  private readonly groups = new Map<string, Group>()
  /**
   * 确认过不存在的范围起点（没有缓存行、读取得到 FS_NOT_FOUND）。按 URI 记住，直到配置变化
   * （clearMissing()）或该目录被重新确认存在（clearMissing(uri)）：范围变化不会让它被反复读取
   */
  private readonly missing = new Set<string>()

  constructor(
    private readonly deps: {
      cache: Cache
      groupKey: (uri: string) => string
      /** 已确认过的目录在此时长内不再选（调度器取该位置「远」层的间隔） */
      minAgeMs: (uri: string) => number
      /** 候选因正在进行等原因暂时不能确认时，多久后再看 */
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
        dirty: false
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

  /** 范围起点读取后确认不存在（且没有缓存行） */
  markMissing(uri: string): void {
    this.missing.add(uri)
  }

  /** 不带参数：配置变化，全部清除；带 uri：该目录被确认存在 */
  clearMissing(uri?: string): void {
    if (uri === undefined) this.missing.clear()
    else if (!this.missing.delete(uri)) return
    for (const g of this.groups.values()) g.retryAt = 0
  }

  /** 丢弃所有候选（共享断开 / 恢复、配置变化：可用的范围或间隔变化） */
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
    // 本次取出后被跳过的候选：最早重新符合条件的时刻；有暂时不能确认的（正在进行等）
    let eligibleAt = Infinity
    let blocked = false
    for (;;) {
      if (g.cursor >= g.batch.length) {
        if (fetched) {
          // 每次调用最多查询一次：取出的候选全都不可用，休眠到最早一个重新符合条件。
          // 查询排除了正在进行的检查（例如 P0）：本组有检查在进行时，它完成后可能重新符合条件，
          // 而修改时间与列表都没变时不会有 markDirty，所以按「暂时不能确认」稍后再看，不能无限休眠
          if (!blocked) {
            blocked = [...opts.running].some((u) => this.deps.groupKey(u) === group)
          }
          g.retryAt = Math.min(eligibleAt, blocked ? opts.now + this.deps.freshMs : Infinity)
          return null
        }
        if (opts.now < g.retryAt) return null
        fetched = true
        eligibleAt = Infinity
        blocked = false
        this.fetch(g, opts)
        continue
      }
      const it = g.batch[g.cursor]!
      const wait = this.waitUntil(g, it, opts.now)
      if (wait !== null || opts.skip(it.uri)) {
        g.cursor += 1
        if (wait !== null) eligibleAt = Math.min(eligibleAt, wait)
        else blocked = true
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

  /**
   * 候选现在是否可以确认：可以返回 null；不可以返回它重新符合条件的时刻（Infinity = 不会再符合：
   * 没有信息的已有了信息或已被删除、起点已确认不存在）。已确认过的目录在 minAgeMs 之内不再确认
   * （含取出后被其他检查确认过的）。
   */
  private waitUntil(g: Group, it: Item, now: number): number | null {
    const d = this.deps.cache.getDir(it.uri)
    if (it.kind === 'unlisted') {
      if (d === undefined) return it.seed && !this.missing.has(it.uri) ? null : Infinity
      return d.checkedAt === null ? null : Infinity
    }
    if (d === undefined || d.checkedAt === null) return Infinity
    const at = d.checkedAt + this.deps.minAgeMs(it.uri)
    return at > now || d.checkedAt >= g.fetchedAt ? Math.max(at, now) : null
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
        .filter((s) => !this.missing.has(s.uri) && this.deps.cache.getDir(s.uri) === undefined)
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
    return [...out.values()]
  }
}
