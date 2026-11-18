import path from 'node:path'
import { pathToFileURL } from 'node:url'
import type { RefreshLevel, RootConfig } from '@pch/shared'
import { fileUriToLocalPath } from '../../main/vfs/local-path'
import { isUnder } from '../cache/cache'

export type Tier = 'P1' | 'P2'

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

export interface ScopeItem {
  uri: string
  tier: Tier
  /** true=每次完整枚举；false=先比较目录修改时间 */
  full: boolean
}

/** 后台逐步展开的子树起点；maxDepth 为相对 uri 的层数上限，null 为不限 */
export interface FrontierItem {
  uri: string
  maxDepth: number | null
}

const LEVEL_RANK: Record<RefreshLevel, number> = { passive: 0, default: 1, active: 2, all: 3 }

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
 * 计算扫描范围（纯函数，设计 4.5 / 4.6）。
 * 范围按「包含关注点的根中 URI 最长者」计算；若关注点落在多个根之下，级别取其中最高者。
 * 不递归遍历整棵树：需要后台逐步展开的子树以 frontier 返回。
 */
export function computeScope(input: ScopeInput): { items: ScopeItem[]; frontier: FrontierItem[] } {
  const items = new Map<string, ScopeItem>()
  const frontier = new Map<string, number | null>()

  const add = (uri: string, tier: Tier, full: boolean): void => {
    const cur = items.get(uri)
    if (!cur) {
      items.set(uri, { uri, tier, full })
      return
    }
    items.set(uri, {
      uri,
      tier: cur.tier === 'P1' || tier === 'P1' ? 'P1' : 'P2',
      full: cur.full || full
    })
  }
  const addFrontier = (uri: string, maxDepth: number | null): void => {
    if (!frontier.has(uri)) {
      frontier.set(uri, maxDepth)
      return
    }
    const cur = frontier.get(uri) ?? null
    frontier.set(uri, cur === null || maxDepth === null ? null : Math.max(cur, maxDepth))
  }
  /** 目录本身与其子目录（「默认」对象，不含祖先） */
  const addWithChildren = (uri: string): void => {
    add(uri, 'P1', false)
    for (const c of input.children(uri)) add(c, 'P1', false)
  }

  // 所有根目录
  for (const r of input.roots) add(r.uri, 'P1', false)

  // 「全部」级别的根：与关注点无关，整棵进入 frontier
  for (const r of input.roots) if (r.level === 'all') addFrontier(r.uri, null)

  // 关注点
  const { focus } = input
  if (focus !== null) {
    const containing = input.roots.filter((r) => isUnder(focus, r.uri))
    if (containing.length > 0) {
      const rootUri = containing.reduce((a, b) => (b.uri.length > a.uri.length ? b : a)).uri
      const level = containing.reduce<RefreshLevel>(
        (a, b) => (LEVEL_RANK[b.level] > LEVEL_RANK[a] ? b.level : a),
        'passive'
      )
      add(focus, 'P1', true)

      if (LEVEL_RANK[level] >= LEVEL_RANK.default) {
        // 祖先链（至根），沿途记录以便取第 N 级祖先
        const ancestors: string[] = []
        let cur = focus
        for (;;) {
          const p = parentUri(cur)
          // 越过根（含根 URI 形态不同、字符串不相等的情形）即停
          if (p === null || !isUnder(p, rootUri)) break
          // 与根是同一路径但 URI 写法不同（如 UNC 共享根的结尾 /）：根已加入，不重复
          if (p !== rootUri && sameLocalPath(p, rootUri)) break
          ancestors.push(p)
          cur = p
          if (cur === rootUri) break
        }
        for (const a of ancestors) add(a, 'P1', false)
        for (const c of input.children(focus)) add(c, 'P1', false)
        const parent = ancestors[0]
        if (parent !== undefined) {
          for (const s of input.children(parent)) if (s !== focus) add(s, 'P1', false)
        }

        if (level === 'active') {
          const up = Math.min(input.activeDepth, ancestors.length)
          const top = up === 0 ? focus : (ancestors[up - 1] ?? focus)
          addFrontier(top, up + input.activeDepth)
        }
      }
    }
  }

  const underRoot = (uri: string): boolean => input.roots.some((r) => isUnder(uri, r.uri))
  for (const h of input.hot) if (underRoot(h)) addWithChildren(h)

  for (const v of input.visible) add(v, 'P1', true)
  for (const o of input.offscreen) add(o, 'P1', false)
  for (const t of input.indexTargets) addFrontier(t, null)

  return {
    items: [...items.values()],
    frontier: [...frontier].map(([uri, maxDepth]) => ({ uri, maxDepth }))
  }
}
