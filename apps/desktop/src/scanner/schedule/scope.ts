import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { isSftpUri, sftpParentUri } from '@pch/shared'
import type { CacheStrategy, RootConfig } from '@pch/shared'
import { fileUriToLocalPath } from '../../main/vfs/local-path'
import { isUnder, type Scope } from '../cache/cache'

/** 定期确认的层（设计 8.2）：关注点 / 近 / 远 */
export type Tier = 'focus' | 'near' | 'far'

export interface ScopeInput {
  roots: RootConfig[]
  /** 关注点目录；没有选中时为 null */
  focus: string | null
  /** 视口内的已展开目录 */
  visible: string[]
  /** 已展开但滚出视口的目录 */
  offscreen: string[]
  /** 标签中显示的目录：与关注点同层（每次完整读取），不扩展周边 */
  tabs: string[]
  hot: string[]
  indexTargets: string[]
  activeDepth: number
  children: (uri: string) => string[]
}

export interface PeriodicItem {
  uri: string
  tier: Tier
  /** true=每次完整读取（关注点）；false=先比较目录修改时间 */
  full: boolean
}

/** 后台队列的范围描述（调度器据此从缓存中按优先级逐个选目录，不在内存中展开） */
export interface BackgroundScope {
  /** 「建立索引」的目录（整棵子树） */
  indexTargets: Scope[]
  /** 缓存策略为「默认」及以上的根之下的热点目录 */
  hot: string[]
  /** 「积极」的关注点上下 N 层范围与「全部」策略的根（整棵子树） */
  ranges: Scope[]
}

/** 层的远近：数值小的更近 */
export const TIER_RANK: Record<Tier, number> = { focus: 0, near: 1, far: 2 }

/**
 * 近层、远层各自的目录数上限（每个窗口）。超出的目录不做定期确认（留给后台队列 ④）：
 * 关注点有上万个兄弟目录时，定期确认的负载与范围计算的成本都不随目录总数增长
 */
export const TIER_LIMIT = 100

const RANK: Record<CacheStrategy, number> = { passive: 0, default: 1, active: 2, all: 3 }

/** 父目录 URI：用与子目录生成相同的路径函数，不手工截字符串；已到文件系统根则返回 null（调度器也用它） */
export function parentUri(uri: string): string | null {
  if (isSftpUri(uri)) return sftpParentUri(uri)
  const p = fileUriToLocalPath(uri)
  const parent = path.dirname(p)
  return parent === p ? null : pathToFileURL(parent).href
}

/** 两个 URI 在目录树上的距离（经最近的共同祖先的层数；按 URI 的路径段计算） */
function treeDistance(a: string, b: string): number {
  const sa = a.replace(/\/+$/, '').split('/')
  const sb = b.replace(/\/+$/, '').split('/')
  let k = 0
  while (k < sa.length && k < sb.length && sa[k] === sb[k]) k += 1
  return sa.length - k + (sb.length - k)
}

const byUri = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

function sameLocalPath(a: string, b: string): boolean {
  const norm = (u: string): string => fileUriToLocalPath(u).replace(/[\\/]+$/, '')
  return norm(a) === norm(b)
}

/**
 * 计算定期确认的对象与后台队列的范围（纯函数，设计 8.2）。
 * - 一个目录的缓存策略取包含它的根中最高者；不在任何根之下的目录不参与。
 * - 关注点的祖先链止于包含它的根中 URI 最长者。
 * - 标签中显示的目录（tabs）在任何策略下都是关注点层（每次完整读取），但不像选中的关注点那样
 *   扩展近 / 远层与「积极」的范围；不在任何根之下的不参与。
 * - 「消极」只有关注点一层；「默认」及以上：近 = 父、子、兄弟与可见的已展开目录，
 *   远 = 祖父以上的祖先、叔伯（父目录的兄弟）、滚出视口的已展开目录与各根目录。同一 URI 取更近的层。
 * - 近层、远层各取 TIER_LIMIT 个：按离关注点的远近（树上的距离；没有关注点时都相同），同等距离时
 *   热点目录优先、再按 URI；近层中视口内可见的已展开目录最优先。超出的目录不做定期确认。
 * - 后台：「建立索引」与策略无关；热点需在「默认」及以上的根之下；「积极」加关注点上下 activeDepth 层；
 *   「全部」加整个根。
 */
export function computeScope(input: ScopeInput): {
  periodic: PeriodicItem[]
  background: BackgroundScope
} {
  const items = new Map<string, Tier>()
  const ranges = new Map<string, number | null>()

  const add = (uri: string, tier: Tier): void => {
    const cur = items.get(uri)
    if (cur === undefined || TIER_RANK[tier] < TIER_RANK[cur]) items.set(uri, tier)
  }
  const addRange = (uri: string, maxDepth: number | null): void => {
    if (!ranges.has(uri)) {
      ranges.set(uri, maxDepth)
      return
    }
    const cur = ranges.get(uri) ?? null
    ranges.set(uri, cur === null || maxDepth === null ? null : Math.max(cur, maxDepth))
  }
  /** 包含 uri 的根中最高的策略；不在任何根之下为 null */
  const strategyOf = (uri: string): CacheStrategy | null => {
    let best: CacheStrategy | null = null
    for (const r of input.roots) {
      if (isUnder(uri, r.uri) && (best === null || RANK[r.strategy] > RANK[best])) best = r.strategy
    }
    return best
  }
  const atLeastDefault = (uri: string): boolean => {
    const s = strategyOf(uri)
    return s !== null && RANK[s] >= RANK.default
  }

  // 关注点
  const { focus } = input
  let center: string | null = null
  if (focus !== null) {
    const containing = input.roots.filter((r) => isUnder(focus, r.uri))
    if (containing.length > 0) {
      const rootUri = containing.reduce((a, b) => (b.uri.length > a.uri.length ? b : a)).uri
      const strategy = strategyOf(focus) ?? 'passive'
      add(focus, 'focus')
      center = focus

      if (RANK[strategy] >= RANK.default) {
        // 祖先链（至根）：ancestors[0] 为父目录
        const ancestors: string[] = []
        let cur = focus
        for (;;) {
          const p = parentUri(cur)
          // 越过根（含根 URI 形态不同、字符串不相等的情形）即停
          if (p === null || !isUnder(p, rootUri)) break
          // 与根是同一路径但 URI 写法不同（如 UNC 共享根的结尾 /）：根另行加入，不重复
          if (p !== rootUri && sameLocalPath(p, rootUri)) break
          ancestors.push(p)
          cur = p
          if (cur === rootUri) break
        }
        const [parent, grandparent] = ancestors
        for (const c of input.children(focus)) add(c, 'near')
        if (parent !== undefined) {
          add(parent, 'near')
          for (const s of input.children(parent)) if (s !== focus) add(s, 'near')
        }
        for (const a of ancestors.slice(1)) add(a, 'far')
        if (grandparent !== undefined && parent !== undefined) {
          for (const u of input.children(grandparent)) if (u !== parent) add(u, 'far')
        }

        if (strategy === 'active') {
          const up = Math.min(input.activeDepth, ancestors.length)
          const top = up === 0 ? focus : (ancestors[up - 1] ?? focus)
          addRange(top, up + input.activeDepth)
        }
      }
    }
  }

  for (const t of input.tabs) if (strategyOf(t) !== null) add(t, 'focus')
  for (const v of input.visible) if (atLeastDefault(v)) add(v, 'near')
  for (const o of input.offscreen) if (atLeastDefault(o)) add(o, 'far')
  for (const r of input.roots) if (atLeastDefault(r.uri)) add(r.uri, 'far')

  // 「全部」策略的根：与关注点无关，整棵进入后台范围
  for (const r of input.roots) if (r.strategy === 'all') addRange(r.uri, null)

  // 近层、远层的上限
  const hotSet = new Set(input.hot)
  const visibleSet = new Set(input.visible)
  const distance = new Map<string, number>()
  const dist = (uri: string): number => {
    let d = distance.get(uri)
    if (d === undefined) {
      d = center === null ? 0 : treeDistance(center, uri)
      distance.set(uri, d)
    }
    return d
  }
  const keep = (tier: Tier): string[] => {
    const list = [...items].filter(([, t]) => t === tier).map(([uri]) => uri)
    if (list.length <= TIER_LIMIT) return list
    const first = (uri: string): number => (tier === 'near' && visibleSet.has(uri) ? 0 : 1)
    const hotFirst = (uri: string): number => (hotSet.has(uri) ? 0 : 1)
    return list
      .sort(
        (a, b) =>
          first(a) - first(b) || dist(a) - dist(b) || hotFirst(a) - hotFirst(b) || byUri(a, b)
      )
      .slice(0, TIER_LIMIT)
  }
  const periodic: PeriodicItem[] = [...items]
    .filter(([, t]) => t === 'focus')
    .map(([uri]) => ({ uri, tier: 'focus' as const, full: true }))
  for (const tier of ['near', 'far'] as const) {
    for (const uri of keep(tier)) periodic.push({ uri, tier, full: false })
  }

  return {
    periodic,
    background: {
      indexTargets: [...new Set(input.indexTargets)].map((uri) => ({ uri, maxDepth: null })),
      hot: input.hot.filter(atLeastDefault),
      ranges: [...ranges].map(([uri, maxDepth]) => ({ uri, maxDepth }))
    }
  }
}
