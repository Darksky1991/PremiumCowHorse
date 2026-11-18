import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { SQLInputValue, SQLOutputValue } from 'node:sqlite'
import { pathToFileURL } from 'node:url'
import { fileUriToLocalPath } from '../../main/vfs/local-path'
import type { RawEntry } from '../enum/types'
import { CACHE_VERSION, CREATE_SQL, DROP_SQL } from './cache-schema'

export type DirState = 'ok' | 'not-found' | 'denied' | 'unreachable'

export interface DirRow {
  uri: string
  parentUri: string | null
  dirMtime: number | null
  listedAt: number | null
  checkedAt: number | null
  state: DirState
  errorCode: string | null
  visitScore: number
}

/** 热点计分的半衰期：3 天 */
const HALF_LIFE_MS = 3 * 24 * 3600 * 1000

type Row = Record<string, SQLOutputValue>

/** 目录 URI 的「根前缀」：根已以 / 结尾（驱动器根 file:///C:/）时不再追加 */
function prefixOf(root: string): string {
  return root.endsWith('/') ? root : `${root}/`
}

/**
 * uri 是否等于 root 或在 root 之下。纯字符串比较、大小写敏感（与 URI 原样一致）：
 * Windows 路径大小写不敏感，大小写不同的同一目录会被视为不同目录——
 * 这里依赖 URI 来自同一来源（工作区条目 + pathToFileURL(path.join(...))）而保持一致。
 */
export function isUnder(uri: string, root: string): boolean {
  return uri === root || uri.startsWith(prefixOf(root))
}

/** 子项 URI：与 LocalProvider.list 的生成方式完全一致（调度器把 RawEntry 转为 FileEntry 时也用它） */
export function childUri(dirUri: string, name: string): string {
  return pathToFileURL(path.join(fileUriToLocalPath(dirUri), name)).href
}

/** 父目录 URI（字符串方式，仅用于目录行尚未由父目录建立时）。根没有父目录 */
function parentOf(uri: string, roots: string[]): string | null {
  if (roots.includes(uri)) return null
  const cut = uri.lastIndexOf('/')
  if (cut <= 0) return null
  const parent = uri.slice(0, cut)
  // 驱动器根的 URI 以 / 结尾：file:///C:/x 的父目录是 file:///C:/
  return /^file:\/\/\/[A-Za-z]:$/.test(parent) ? `${parent}/` : parent
}

function sameEntry(a: RawEntry, b: RawEntry): boolean {
  return (
    a.kind === b.kind &&
    (a.target ?? null) === (b.target ?? null) &&
    a.size === b.size &&
    a.mtime === b.mtime &&
    a.hidden === b.hidden
  )
}

function toEntry(r: Row): RawEntry {
  const e: RawEntry = {
    name: r.name as string,
    kind: r.kind as RawEntry['kind'],
    size: Number(r.size),
    mtime: r.mtime as number,
    hidden: r.hidden === 1
  }
  if (e.kind === 'symlink') e.target = (r.target as 'file' | 'directory' | null) ?? null
  return e
}

function toDirRow(r: Row): DirRow {
  return {
    uri: r.uri as string,
    parentUri: r.parent_uri as string | null,
    dirMtime: r.dir_mtime as number | null,
    listedAt: r.listed_at as number | null,
    checkedAt: r.checked_at as number | null,
    state: r.state as DirState,
    errorCode: r.error_code as string | null,
    visitScore: r.visit_score as number
  }
}

/**
 * 目录列表缓存（userData/cache/index.db，可随时删除重建）。只在扫描进程使用。
 * 条目按目录存放；entries_fts（FTS5 trigram，external content + 触发器）供文件名搜索。
 * 「配置的根」只保存在内存里：扫描进程每次启动由主进程重新设置。
 */
export class Cache {
  private roots: string[] = []

  private constructor(private readonly db: DatabaseSync) {}

  /** user_version 不符（或为未知结构）→ 删表重建 */
  static open(file: string | ':memory:'): Cache {
    if (file !== ':memory:') mkdirSync(path.dirname(file), { recursive: true })
    const db = new DatabaseSync(file)
    db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON;')
    const version = Number(db.prepare('PRAGMA user_version').get()?.user_version ?? 0)
    if (version !== CACHE_VERSION) {
      db.exec('BEGIN')
      try {
        db.exec(DROP_SQL)
        db.exec(CREATE_SQL)
        db.exec(`PRAGMA user_version = ${CACHE_VERSION}`)
        db.exec('COMMIT')
      } catch (e) {
        db.exec('ROLLBACK')
        db.close()
        throw e
      }
    }
    return new Cache(db)
  }

  /** 当前配置的所有根（所有工作区的所有 folder 条目） */
  setRoots(rootUris: string[]): void {
    this.roots = [...rootUris]
  }

  getDir(uri: string): DirRow | undefined {
    const r = this.get('SELECT * FROM dirs WHERE uri = ?', uri)
    return r ? toDirRow(r) : undefined
  }

  getEntries(uri: string): RawEntry[] {
    return this.all('SELECT * FROM entries WHERE dir_uri = ? ORDER BY name', uri).map(toEntry)
  }

  childDirs(uri: string): string[] {
    return this.all('SELECT uri FROM dirs WHERE parent_uri = ?', uri).map((r) => r.uri as string)
  }

  /**
   * 写入一个目录的完整列表（一个事务）。按差异更新 entries（避免 FTS 索引无谓重建），
   * 为子目录建立 dirs 行，清理已不存在的子目录子树。目录不在任何根之下时忽略。
   */
  applyListing(
    uri: string,
    dirMtime: number,
    entries: RawEntry[],
    now: number
  ): { changed: boolean } {
    if (!this.underRoots(uri)) return { changed: false }
    return this.tx(() => {
      const prev = this.get('SELECT state, listed_at FROM dirs WHERE uri = ?', uri)
      let changed = !prev || prev.listed_at === null || prev.state !== 'ok'

      // 目录自身行
      this.db
        .prepare(
          `INSERT INTO dirs (uri, parent_uri, dir_mtime, listed_at, checked_at, state, error_code)
           VALUES (?, ?, ?, ?, ?, 'ok', NULL)
           ON CONFLICT(uri) DO UPDATE SET dir_mtime = excluded.dir_mtime, listed_at = excluded.listed_at,
             checked_at = excluded.checked_at, state = 'ok', error_code = NULL`
        )
        .run(uri, parentOf(uri, this.roots), dirMtime, now, now)

      const old = new Map(this.getEntries(uri).map((e) => [e.name, e]))
      const seen = new Set<string>()
      const insert = this.db.prepare(
        'INSERT INTO entries (dir_uri, name, kind, target, size, mtime, hidden) VALUES (?, ?, ?, ?, ?, ?, ?)'
      )
      const update = this.db.prepare(
        'UPDATE entries SET kind = ?, target = ?, size = ?, mtime = ?, hidden = ? WHERE dir_uri = ? AND name = ?'
      )
      const remove = this.db.prepare('DELETE FROM entries WHERE dir_uri = ? AND name = ?')
      const childDirUris = new Set<string>()
      for (const e of entries) {
        seen.add(e.name)
        if (e.kind === 'directory') childDirUris.add(childUri(uri, e.name))
        const before = old.get(e.name)
        const target = e.kind === 'symlink' ? (e.target ?? null) : null
        if (!before) {
          insert.run(uri, e.name, e.kind, target, e.size, e.mtime, e.hidden ? 1 : 0)
          changed = true
        } else if (!sameEntry(before, e)) {
          update.run(e.kind, target, e.size, e.mtime, e.hidden ? 1 : 0, uri, e.name)
          changed = true
        }
      }
      for (const name of old.keys()) {
        if (!seen.has(name)) {
          remove.run(uri, name)
          changed = true
        }
      }

      // 子目录行：新增的建立，消失的（含变成文件的）连同子树删除
      const insertChild = this.db.prepare(
        "INSERT OR IGNORE INTO dirs (uri, parent_uri, state) VALUES (?, ?, 'ok')"
      )
      for (const c of childDirUris) insertChild.run(c, uri)
      for (const c of this.childDirs(uri)) {
        if (!childDirUris.has(c)) {
          this.removeSubtreeRows(c)
          changed = true
        }
      }
      return { changed }
    })
  }

  markChecked(uri: string, now: number): void {
    this.run('UPDATE dirs SET checked_at = ? WHERE uri = ?', now, uri)
  }

  /** 记录目录的状态（错误等）。缓存的条目保留。目录不在任何根之下时忽略 */
  setState(
    uri: string,
    state: DirState,
    errorCode: string | null,
    now: number
  ): { changed: boolean } {
    if (!this.underRoots(uri)) return { changed: false }
    const prev = this.getDir(uri)
    this.ensureDir(uri)
    this.run(
      'UPDATE dirs SET state = ?, error_code = ?, checked_at = ? WHERE uri = ?',
      state,
      errorCode,
      now,
      uri
    )
    return { changed: !prev || prev.state !== state || prev.errorCode !== errorCode }
  }

  /** 删除该目录及其全部子目录（连同条目） */
  removeSubtree(uri: string): void {
    this.tx(() => this.removeSubtreeRows(uri))
  }

  /** 删除不在任何根之下的目录（连同条目），返回删除的目录数 */
  prune(): number {
    return this.tx(() => {
      const stale = this.all('SELECT uri FROM dirs')
        .map((r) => r.uri as string)
        .filter((u) => !this.underRoots(u))
      const delEntries = this.db.prepare('DELETE FROM entries WHERE dir_uri = ?')
      const delDir = this.db.prepare('DELETE FROM dirs WHERE uri = ?')
      for (const u of stale) {
        delEntries.run(u)
        delDir.run(u)
      }
      return stale.length
    })
  }

  /** 热点计分：score = score·0.5^(Δt/3d) + 1。目录在根之下但还没有行时先建立 */
  visit(uri: string, now: number): void {
    if (!this.underRoots(uri)) return
    this.tx(() => {
      this.ensureDir(uri)
      const r = this.get('SELECT visit_score, visited_at FROM dirs WHERE uri = ?', uri)
      const prevScore = Number(r?.visit_score ?? 0)
      const prevAt = r?.visited_at == null ? now : Number(r.visited_at)
      const decayed = prevScore * Math.pow(0.5, Math.max(0, now - prevAt) / HALF_LIFE_MS)
      this.run(
        'UPDATE dirs SET visit_score = ?, visited_at = ? WHERE uri = ?',
        decayed + 1,
        now,
        uri
      )
    })
  }

  /**
   * 热度最高的 k 个目录。各目录的计分时刻不同，按 log2(score) + visited_at/半衰期 排序：
   * 这与「折算到同一时刻后比较」等价（与折算时刻无关），所以不需要 now。
   */
  hot(k: number): string[] {
    if (k <= 0) return []
    return this.all('SELECT uri, visit_score, visited_at FROM dirs WHERE visit_score > 0')
      .map((r) => ({
        uri: r.uri as string,
        key: Math.log2(r.visit_score as number) + Number(r.visited_at) / HALF_LIFE_MS
      }))
      .sort((a, b) => b.key - a.key)
      .slice(0, k)
      .map((x) => x.uri)
  }

  sizeBytes(): number {
    const r = this.db
      .prepare(
        'SELECT (SELECT page_count FROM pragma_page_count) * (SELECT page_size FROM pragma_page_size) AS n'
      )
      .get()
    return Number(r?.n ?? 0)
  }

  clear(): void {
    this.tx(() => {
      this.db.exec('DELETE FROM entries; DELETE FROM dirs;')
    })
    this.db.exec('VACUUM')
  }

  close(): void {
    this.db.close()
  }

  // ---- 内部 ----

  private underRoots(uri: string): boolean {
    return this.roots.some((r) => isUnder(uri, r))
  }

  private ensureDir(uri: string): void {
    this.run(
      "INSERT OR IGNORE INTO dirs (uri, parent_uri, state) VALUES (?, ?, 'ok')",
      uri,
      parentOf(uri, this.roots)
    )
  }

  private removeSubtreeRows(uri: string): void {
    const prefix = prefixOf(uri)
    const n = prefix.length
    this.run('DELETE FROM entries WHERE dir_uri = ? OR substr(dir_uri, 1, ?) = ?', uri, n, prefix)
    this.run('DELETE FROM dirs WHERE uri = ? OR substr(uri, 1, ?) = ?', uri, n, prefix)
  }

  private tx<T>(fn: () => T): T {
    this.db.exec('BEGIN')
    try {
      const r = fn()
      this.db.exec('COMMIT')
      return r
    } catch (e) {
      this.db.exec('ROLLBACK')
      throw e
    }
  }

  private run(sql: string, ...params: SQLInputValue[]): void {
    this.db.prepare(sql).run(...params)
  }

  private get(sql: string, ...params: SQLInputValue[]): Row | undefined {
    return this.db.prepare(sql).get(...params)
  }

  private all(sql: string, ...params: SQLInputValue[]): Row[] {
    return this.db.prepare(sql).all(...params)
  }
}
