import path from 'node:path'
import { pathToFileURL } from 'node:url'
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

const RANK: Record<CacheStrategy, number> = { passive: 0, default: 1, active: 2, all: 3 }

/** 父目录 URI：用与子目录生成相同的路径函数，不手工截字符串；已到文件系统根则返回 null（调度器也用它） */
export function parentUri(uri: string): string | null {
  const p = fileUriToLocalPath(uri)
  const parent = path.dirname(p)
  return parent === p ? null : pathToFileURL(parent).href
}

function sameLocalPath(a: string, b: string): boolean {
  const norm = (u: string): string => fileUriToLocalPath(u).replace(/[\\/]+$/, '')
  return norm(a) === norm(b)
}

/**
 * 计算定期确认的对象与后台队列的范围（纯函数，设计 8.2）。
 * - 一个目录的缓存策略取包含它的根中最高者；不在任何根之下的目录不参与。
 * - 关注点的祖先链止于包含它的根中 URI 最长者。
 * - 「消极」只有关注点一层；「默认」及以上：近 = 父、子、兄弟与可见的已展开目录，
 *   远 = 祖父以上的祖先、叔伯（父目录的兄弟）、滚出视口的已展开目录与各根目录。同一 URI 取更近的层。
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
  if (focus !== null) {
    const containing = input.roots.filter((r) => isUnder(focus, r.uri))
    if (containing.length > 0) {
      const rootUri = containing.reduce((a, b) => (b.uri.length > a.uri.length ? b : a)).uri
      const strategy = strategyOf(focus) ?? 'passive'
      add(focus, 'focus')

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

  for (const v of input.visible) if (atLeastDefault(v)) add(v, 'near')
  for (const o of input.offscreen) if (atLeastDefault(o)) add(o, 'far')
  for (const r of input.roots) if (atLeastDefault(r.uri)) add(r.uri, 'far')

  // 「全部」策略的根：与关注点无关，整棵进入后台范围
  for (const r of input.roots) if (r.strategy === 'all') addRange(r.uri, null)

  return {
    periodic: [...items].map(([uri, tier]) => ({ uri, tier, full: tier === 'focus' })),
    background: {
      indexTargets: [...new Set(input.indexTargets)].map((uri) => ({ uri, maxDepth: null })),
      hot: input.hot.filter(atLeastDefault),
      ranges: [...ranges].map(([uri, maxDepth]) => ({ uri, maxDepth }))
    }
  }
}
