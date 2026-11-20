import type { FileKind } from '../vfs/types'

/** 搜索词：contains = 名称包含；glob = 含 * / ? 的通配（匹配整个名称）。均不区分大小写 */
export interface SearchTerm {
  kind: 'contains' | 'glob'
  value: string
}

/** 搜索范围：一个 folder 条目的根 */
export interface SearchScope {
  uri: string
  entryId: string
  label: string
}

export type SearchKindFilter = 'all' | 'file' | 'directory'

/** 扫描进程中的查询（缓存只读） */
export interface SearchQuery {
  scopes: SearchScope[]
  terms: SearchTerm[]
  kind: SearchKindFilter
  showHidden: boolean
  limit: number
}

export interface SearchHit {
  uri: string
  name: string
  kind: FileKind
  size: number
  mtime: number
  hidden: boolean
  /** 最长前缀匹配的条目 */
  entryId: string
  /** 命中项相对所属条目根的路径（含名称），用 / 分隔、已解码（显示用）；固定的单个文件条目为空字符串 */
  relativePath: string
}

export interface SearchResult {
  items: SearchHit[]
  /** 匹配总数，最多计数到 SEARCH_TOTAL_CAP（达到时渲染端显示「10000+」） */
  total: number
  truncated: boolean
  /** 范围内目录 checked_at 的最小值；没有任何记录时为 null */
  indexedAt: number | null
  /** 范围内存在从未列出过的目录 */
  incomplete: boolean
}

export const SEARCH_TOTAL_CAP = 10000
export const SEARCH_LIMIT_MAX = 1000
