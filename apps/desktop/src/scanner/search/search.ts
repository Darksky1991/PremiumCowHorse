import {
  SEARCH_LIMIT_MAX,
  SEARCH_TOTAL_CAP,
  prefixOf,
  type FileKind,
  type SearchHit,
  type SearchQuery,
  type SearchResult,
  type SearchScope,
  type SearchTerm
} from '@pch/shared'
import type { SQLInputValue } from 'node:sqlite'
import { Cache, childUri, isUnder } from '../cache/cache'

/** trigram 索引只能查 3 个字符（按 Unicode 码点计）以上的词 */
const FTS_MIN = 3

const escapeLike = (s: string): string => s.replace(/[\\%_]/g, '\\$&')
/** GLOB 中 [ 开启字符集，按字面匹配要写成 [[]；* 与 ? 保留为通配 */
const escapeGlob = (s: string): string => s.replace(/\[/g, '[[]')
const ftsPhrase = (s: string): string => `"${s.replaceAll('"', '""')}"`

/**
 * URI 前缀范围条件（对应 shared 的 isUnderUri：等于根，或以「根 + /」开头）。
 * 写成范围比较而不是 LIKE：不需要转义通配符，并且能用主键 / 目录主键的索引。
 * 前缀以 / 结尾，字典序上紧随其后的是把 / 换成 0（'/' + 1）。
 */
function scopeCondition(column: string, scopes: SearchScope[]): { sql: string; params: string[] } {
  const params: string[] = []
  const parts = scopes.map((s) => {
    const prefix = prefixOf(s.uri)
    params.push(s.uri, prefix, `${prefix.slice(0, -1)}0`)
    return `(${column} = ? OR (${column} >= ? AND ${column} < ?))`
  })
  return { sql: `(${parts.join(' OR ')})`, params }
}

function termConditions(terms: SearchTerm[]): { sql: string[]; params: SQLInputValue[] } {
  const sql: string[] = []
  const params: SQLInputValue[] = []
  const fts = terms.filter((t) => t.kind === 'contains' && [...t.value].length >= FTS_MIN)
  if (fts.length > 0) {
    sql.push('e.rowid IN (SELECT rowid FROM entries_fts WHERE entries_fts MATCH ?)')
    params.push(fts.map((t) => ftsPhrase(t.value)).join(' AND '))
  }
  for (const t of terms) {
    if (fts.includes(t)) continue
    if (t.kind === 'contains') {
      sql.push("e.name LIKE ? ESCAPE '\\'")
      params.push(`%${escapeLike(t.value)}%`)
    } else {
      sql.push('lower(e.name) GLOB lower(?)')
      params.push(escapeGlob(t.value))
    }
  }
  return { sql, params }
}

const KIND_SQL = {
  all: null,
  file: "e.kind <> 'directory' AND NOT (e.kind = 'symlink' AND e.target = 'directory')",
  directory: "(e.kind = 'directory' OR (e.kind = 'symlink' AND e.target = 'directory'))"
} as const

function decodeSegment(s: string): string {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

/** 命中项所属条目：最长前缀匹配 */
function owner(dirUri: string, scopes: SearchScope[]): SearchScope {
  let best = scopes[0]!
  for (const s of scopes) {
    if (isUnder(dirUri, s.uri) && (!isUnder(dirUri, best.uri) || s.uri.length > best.uri.length)) {
      best = s
    }
  }
  return best
}

function relativePath(dirUri: string, name: string, scope: SearchScope): string {
  if (dirUri === scope.uri) return name
  const rel = dirUri.slice(prefixOf(scope.uri).length).split('/').map(decodeSegment).join('/')
  return `${rel}/${name}`
}

/**
 * 在缓存中按名称搜索（只读缓存，绝不访问文件系统）。规则见 shared 的 parseQuery / matchesName：
 * 全部词 AND；3 字符以上的包含词走 entries_fts（trigram），短词与通配词在候选集上过滤。
 * 同步执行（node:sqlite），在扫描进程中运行；没有词或没有范围时结果为空。
 */
export function search(cache: Cache, q: SearchQuery): SearchResult {
  const empty: SearchResult = {
    items: [],
    total: 0,
    truncated: false,
    indexedAt: null,
    incomplete: false
  }
  if (q.scopes.length === 0) return empty

  const dirScope = scopeCondition('uri', q.scopes)
  const meta = cache.select(
    `SELECT MIN(checked_at) AS m, COALESCE(MAX(listed_at IS NULL), 0) AS inc FROM dirs WHERE ${dirScope.sql}`,
    ...dirScope.params
  )[0]
  const indexedAt = meta?.m == null ? null : Number(meta.m)
  const incomplete = Number(meta?.inc ?? 0) === 1
  if (q.terms.length === 0) return { ...empty, indexedAt, incomplete }

  const limit = Math.max(1, Math.min(Math.floor(q.limit), SEARCH_LIMIT_MAX))
  const entryScope = scopeCondition('e.dir_uri', q.scopes)
  const conds = [entryScope.sql]
  const params: SQLInputValue[] = [...entryScope.params]
  if (!q.showHidden) conds.push('e.hidden = 0')
  const kindSql = KIND_SQL[q.kind]
  if (kindSql) conds.push(kindSql)
  const tc = termConditions(q.terms)
  conds.push(...tc.sql)
  params.push(...tc.params)
  const where = conds.join(' AND ')

  const total = Number(
    cache.select(
      `SELECT count(*) AS n FROM (SELECT 1 FROM entries e WHERE ${where} LIMIT ${SEARCH_TOTAL_CAP})`,
      ...params
    )[0]?.n ?? 0
  )

  // 名称以第一个包含词开头者优先（通配词匹配整个名称，不参与优先）
  const first = q.terms[0]!
  const rank =
    first.kind === 'contains' ? "CASE WHEN e.name LIKE ? ESCAPE '\\' THEN 0 ELSE 1 END, " : ''
  const rankParams: SQLInputValue[] =
    first.kind === 'contains' ? [`${escapeLike(first.value)}%`] : []
  const rows = cache.select(
    `SELECT e.dir_uri, e.name, e.kind, e.size, e.mtime, e.hidden FROM entries e WHERE ${where}
     ORDER BY ${rank}e.name, e.dir_uri LIMIT ${limit}`,
    ...params,
    ...rankParams
  )

  const items: SearchHit[] = rows.map((r) => {
    const dirUri = r.dir_uri as string
    const name = r.name as string
    const scope = owner(dirUri, q.scopes)
    return {
      uri: childUri(dirUri, name),
      name,
      kind: r.kind as FileKind,
      size: Number(r.size),
      mtime: r.mtime as number,
      hidden: r.hidden === 1,
      entryId: scope.entryId,
      relativePath: relativePath(dirUri, name, scope)
    }
  })
  return { items, total, truncated: total > items.length, indexedAt, incomplete }
}
