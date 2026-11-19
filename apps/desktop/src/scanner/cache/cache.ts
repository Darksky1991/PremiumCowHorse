import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { SQLInputValue, SQLOutputValue } from 'node:sqlite'
import { pathToFileURL } from 'node:url'
import { fileUriToLocalPath } from '../../main/vfs/local-path'
import { isUnderUri as isUnder, prefixOf } from '@pch/shared'
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

/** 队列查询的范围：scope.uri 本身及其下 maxDepth 层（0 = 只有它自己，1 = 它与直接子目录，null = 不限） */
export interface Scope {
  uri: string
  maxDepth: number | null
}

/** 热点计分的半衰期：3 天 */
const HALF_LIFE_MS = 3 * 24 * 3600 * 1000

type Row = Record<string, SQLOutputValue>

// 判断「在根之下」的实现与主进程共用（packages/shared 的 vfs/normalize-uri.ts），此处保留原导出名
export { isUnder }

/** 子项 URI：与 LocalProvider.list 的生成方式完全一致（调度器把 RawEntry 转为 FileEntry 时也用它） */
export function childUri(dirUri: string, name: string): string {
  return pathToFileURL(path.join(fileUriToLocalPath(dirUri), name)).href
}

/**
 * 「等于其中某个 URI 或在其之下」的 SQL 条件（对应 isUnder：等于根，或以「根 + /」开头）。
 * 写成范围比较而不是 LIKE / substr：不需要转义通配符，并且能用 dirs.uri 的唯一索引。前缀以 / 结尾，字典序上紧随其后的是把 / 换成 0（'/' + 1）。
 * 缓存的子树删除与搜索的范围共用这一份实现（条件只作用在 dirs.uri 上，entries 经 dir_id 关联）。
 */
export function subtreeCondition(
  column: string,
  uris: readonly string[]
): { sql: string; params: string[] } {
  const params: string[] = []
  const parts = uris.map((uri) => {
    const prefix = prefixOf(uri)
    params.push(uri, prefix, `${prefix.slice(0, -1)}0`)
    return `(${column} = ? OR (${column} >= ? AND ${column} < ?))`
  })
  return { sql: `(${parts.join(' OR ')})`, params }
}

/** URI 的层级数（「/」的个数）。驱动器根（file:///C:/）末尾的 / 不算：它与 file:///C:/x 的差是一层 */
function slashDepth(uri: string): number {
  const n = uri.split('/').length - 1
  return uri.endsWith('/') ? n - 1 : n
}

type QueueKind = 'unlisted' | 'checked'

/** 范围内行数达到此值时，队列查询改为按索引顺序扫描（见 Cache.countInScope） */
const INDEX_SCAN_THRESHOLD = 2000

/** 队列查询的 WHERE 条件：状态、范围（主键范围查找）、层数（dirs.depth 生成列）、排除项 */
function queueWhere(
  kind: QueueKind,
  scope: Scope,
  exclude: Set<string> | undefined
): { where: string; params: SQLInputValue[] } {
  const range = subtreeCondition('uri', [scope.uri])
  const params: SQLInputValue[] = [...range.params]
  let where = `checked_at IS ${kind === 'unlisted' ? '' : 'NOT '}NULL AND ${range.sql}`
  if (scope.maxDepth !== null) {
    where += ' AND depth <= ?'
    params.push(slashDepth(scope.uri) + scope.maxDepth)
  }
  // 排除项通常很少（正在处理的目录），逐个排除
  const ex = exclude ? [...exclude] : []
  if (ex.length > 0) {
    where += ` AND uri NOT IN (${ex.map(() => '?').join(', ')})`
    params.push(...ex)
  }
  return { where, params }
}

/**
 * 队列查询的 SQL。indexed 为 true 时用 INDEXED BY 固定按队列索引的顺序扫描
 * （unlisted：(depth, uri)；checked：(checked_at, uri, depth)），范围条件作为过滤，配合 LIMIT 很快结束；
 * 否则走主键范围查找再排序（范围小时最快）。
 */
export function queueQuery(
  kind: QueueKind,
  scope: Scope,
  limit: number,
  exclude: Set<string> | undefined,
  indexed: boolean
): { sql: string; params: SQLInputValue[] } {
  const unlisted = kind === 'unlisted'
  const { where, params } = queueWhere(kind, scope, exclude)
  const index = indexed ? ` INDEXED BY ${unlisted ? 'dirs_unlisted' : 'dirs_checked'}` : ''
  const order = unlisted ? 'depth' : 'checked_at'
  return {
    sql: `SELECT uri, ${order} AS key FROM dirs${index} WHERE ${where} ORDER BY ${order}, uri LIMIT ?`,
    params: [...params, limit]
  }
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
 * 条目按目录存放（entries.dir_id 引用 dirs.id，删除目录时级联删除）；entries_fts（FTS5 trigram，external content + 触发器）供文件名搜索。
 * 「配置的根」只保存在内存里：扫描进程每次启动由主进程重新设置。
 */
export class Cache {
  private roots: string[] = []

  private constructor(private readonly db: DatabaseSync) {}

  /**
   * user_version 不符（或为未知结构）→ 删表重建。打开失败（例如 file is not a database）时
   * 先关闭连接再抛出：否则文件句柄不释放，Windows 上调用方无法删除损坏的文件重建。
   */
  static open(file: string | ':memory:'): Cache {
    if (file !== ':memory:') mkdirSync(path.dirname(file), { recursive: true })
    const db = new DatabaseSync(file)
    try {
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
          throw e
        }
      }
    } catch (e) {
      db.close()
      throw e
    }
    return new Cache(db)
  }

  /** 当前配置的所有根（所有工作区的所有 folder 条目） */
  setRoots(rootUris: string[]): void {
    this.roots = [...rootUris]
  }

  getDir(uri: string): DirRow | undefined {
    const r = this.get(
      `SELECT d.*, p.uri AS parent_uri FROM dirs d LEFT JOIN dirs p ON p.id = d.parent_id WHERE d.uri = ?`,
      uri
    )
    if (!r) return undefined
    const row = toDirRow(r)
    // 父目录行还不存在（先访问了深层目录）时 parent_id 为空：回落到字符串方式
    return { ...row, parentUri: row.parentUri ?? parentOf(uri, this.roots) }
  }

  getEntries(uri: string): RawEntry[] {
    return this.all(
      'SELECT e.* FROM entries e WHERE e.dir_id = (SELECT id FROM dirs WHERE uri = ?) ORDER BY e.name',
      uri
    ).map(toEntry)
  }

  childDirs(uri: string): string[] {
    return this.all(
      'SELECT uri FROM dirs WHERE parent_id = (SELECT id FROM dirs WHERE uri = ?)',
      uri
    ).map((r) => r.uri as string)
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

      // 目录自身行。不用 ON CONFLICT 的插入：冲突的插入也会消耗 AUTOINCREMENT 的编号
      const parentId = this.idOf(parentOf(uri, this.roots))
      const { id: dirId, created: ownCreated } = this.upsertDir(uri, parentId, {
        dirMtime,
        listedAt: now,
        checkedAt: now,
        state: 'ok'
      })

      const old = new Map(
        this.all('SELECT * FROM entries WHERE dir_id = ?', dirId).map((r) => [
          r.name as string,
          toEntry(r)
        ])
      )
      const seen = new Set<string>()
      const insert = this.db.prepare(
        'INSERT INTO entries (dir_id, name, kind, target, size, mtime, hidden) VALUES (?, ?, ?, ?, ?, ?, ?)'
      )
      const update = this.db.prepare(
        'UPDATE entries SET kind = ?, target = ?, size = ?, mtime = ?, hidden = ? WHERE dir_id = ? AND name = ?'
      )
      const remove = this.db.prepare('DELETE FROM entries WHERE dir_id = ? AND name = ?')
      const childDirUris = new Set<string>()
      for (const e of entries) {
        seen.add(e.name)
        if (e.kind === 'directory') childDirUris.add(childUri(uri, e.name))
        const before = old.get(e.name)
        const target = e.kind === 'symlink' ? (e.target ?? null) : null
        if (!before) {
          insert.run(dirId, e.name, e.kind, target, e.size, e.mtime, e.hidden ? 1 : 0)
          changed = true
        } else if (!sameEntry(before, e)) {
          update.run(e.kind, target, e.size, e.mtime, e.hidden ? 1 : 0, dirId, e.name)
          changed = true
        }
      }
      for (const name of old.keys()) {
        if (!seen.has(name)) {
          remove.run(dirId, name)
          changed = true
        }
      }

      // 子目录行：新增的建立（已存在的行，例如先访问了深层目录时建立的，补上 parent_id），
      // 消失的（含变成文件的）连同子树删除。逐个子目录查找：不存在则建立，已有的补 parent_id（准备好语句，目录可能有几万个子目录）
      const find = this.db.prepare('SELECT id, parent_id FROM dirs WHERE uri = ?')
      const insertChild = this.db.prepare(
        "INSERT INTO dirs (uri, parent_id, state) VALUES (?, ?, 'ok')"
      )
      const setParent = this.db.prepare('UPDATE dirs SET parent_id = ? WHERE id = ?')
      let created = ownCreated
      for (const c of childDirUris) {
        const r = find.get(c)
        if (!r) {
          insertChild.run(c, dirId)
          created = true
        } else if (r.parent_id !== dirId) {
          setParent.run(dirId, r.id as number)
        }
      }
      if (created) this.adoptOrphans()
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

  /**
   * 目录已不存在（读取得到「不存在」）：删除它与全部子目录，并从父目录的缓存列表中删除该项
   * （一个事务）。父目录列表中同名的是符号链接时保留（链接本身可能仍在，只是目标不在）。
   * 删除了该项时父目录的 dir_mtime 置为 NULL：这是推断而不是父目录的真实列表（例如上级目录改名期间
   * 读取、随即改回，父目录的修改时间不变），下一次确认父目录时必须完整读取，不能按修改时间判为未变。
   * parentChanged：父目录的列表有变化
   */
  removeMissing(uri: string): { parentChanged: boolean } {
    return this.tx(() => {
      const row = this.get(
        'SELECT p.uri AS parent_uri FROM dirs d JOIN dirs p ON p.id = d.parent_id WHERE d.uri = ?',
        uri
      )
      const parent = (row?.parent_uri as string | null | undefined) ?? parentOf(uri, this.roots)
      this.removeSubtreeRows(uri)
      if (parent === null) return { parentChanged: false }
      const name = path.basename(fileUriToLocalPath(uri))
      // 名称经与列表相同的函数还原：不一致（例如 URI 写法不同）时不猜测
      if (name === '' || childUri(parent, name) !== uri) return { parentChanged: false }
      const r = this.db
        .prepare(
          "DELETE FROM entries WHERE dir_id = (SELECT id FROM dirs WHERE uri = ?) AND name = ? AND kind = 'directory'"
        )
        .run(parent, name)
      const parentChanged = Number(r.changes) > 0
      if (parentChanged) this.run('UPDATE dirs SET dir_mtime = NULL WHERE uri = ?', parent)
      return { parentChanged }
    })
  }

  /** 删除不在任何根之下的目录（连同条目），返回删除的目录数 */
  prune(): number {
    return this.tx(() => {
      const stale = this.all('SELECT uri FROM dirs')
        .map((r) => r.uri as string)
        .filter((u) => !this.underRoots(u))
      // 条目随目录级联删除
      const delDir = this.db.prepare('DELETE FROM dirs WHERE uri = ?')
      for (const u of stale) delDir.run(u)
      // 留下的行（例如根）的 parent_id 可能指向刚删除的行：置空，之后父目录行重建时由 adoptOrphans 认领
      if (stale.length > 0)
        this.run(
          'UPDATE dirs SET parent_id = NULL WHERE parent_id IS NOT NULL AND parent_id NOT IN (SELECT id FROM dirs)'
        )
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

  /**
   * 从未尝试读取过的目录（checked_at 为 NULL：只从父目录的列表得知存在），范围内「深度浅的优先、
   * 同深度按 uri」（由上而下）。读取失败的目录（拒绝访问等）也会写 checked_at，所以不会永远排在最前。
   * 多个范围的结果合并去重，limit 为合并后的总数。
   */
  nextUnlisted(scopes: Scope[], limit: number, exclude?: Set<string>): string[] {
    return this.queue('unlisted', scopes, limit, exclude)
  }

  /**
   * 尝试过读取的目录（checked_at 不为 NULL，含失败的），范围内按 checked_at 升序（最久没确认的在前）。
   * 多个范围的结果合并去重，limit 为合并后的总数。
   */
  oldestChecked(scopes: Scope[], limit: number, exclude?: Set<string>): string[] {
    return this.queue('checked', scopes, limit, exclude)
  }

  /** 只读查询（搜索用）：调用方保证 sql 是 SELECT */
  select(sql: string, ...params: SQLInputValue[]): Record<string, SQLOutputValue>[] {
    return this.all(sql, ...params)
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
    if (this.idOf(uri) === null) {
      this.upsertDir(uri, this.idOf(parentOf(uri, this.roots)))
      this.adoptOrphans()
    }
  }

  private idOf(uri: string | null): number | null {
    if (uri === null) return null
    const r = this.get('SELECT id FROM dirs WHERE uri = ?', uri)
    return r ? Number(r.id) : null
  }

  /**
   * 建立目录行，或更新已有行的 parent_id（与 fields 中给出的列），返回编号与是否新建（新建后调用方需认领先于它建立的子目录，见 adoptOrphans）。
   * 先查再写而不用 INSERT … ON CONFLICT：冲突的插入也会消耗 AUTOINCREMENT 的编号（每次刷新都会烧掉一批）
   */
  private upsertDir(
    uri: string,
    parentId: number | null,
    fields?: { dirMtime: number; listedAt: number; checkedAt: number; state: DirState }
  ): { id: number; created: boolean } {
    const id = this.idOf(uri)
    if (id === null) {
      const r = this.get(
        `INSERT INTO dirs (uri, parent_id, dir_mtime, listed_at, checked_at, state)
         VALUES (?, ?, ?, ?, ?, ?) RETURNING id`,
        uri,
        parentId,
        fields?.dirMtime ?? null,
        fields?.listedAt ?? null,
        fields?.checkedAt ?? null,
        fields?.state ?? 'ok'
      )
      return { id: Number(r!.id), created: true }
    }
    if (fields) {
      this.run(
        'UPDATE dirs SET parent_id = COALESCE(?, parent_id), dir_mtime = ?, listed_at = ?, checked_at = ?, state = ?, error_code = NULL WHERE id = ?',
        parentId,
        fields.dirMtime,
        fields.listedAt,
        fields.checkedAt,
        fields.state,
        id
      )
    } else {
      this.run(
        'UPDATE dirs SET parent_id = ? WHERE id = ? AND parent_id IS NOT ?',
        parentId,
        id,
        parentId
      )
    }
    return { id, created: false }
  }

  /**
   * 认领 parent_id 为空的非根目录（先访问了深层目录时，那一行建立时父目录行还不存在）：父目录行现在存在的，
   * 补上 parent_id。parent_id 为空的行只有根与这类孤儿，经 dirs_parent 索引读取，数量很少；
   * 每次新建目录行之后调用一次（不是每个新行一次：一个目录有几万个子目录时逐个查询太慢）
   */
  private adoptOrphans(): void {
    for (const r of this.all('SELECT id, uri FROM dirs WHERE parent_id IS NULL')) {
      const parent = this.idOf(parentOf(r.uri as string, this.roots))
      if (parent !== null)
        this.run('UPDATE dirs SET parent_id = ? WHERE id = ?', parent, r.id as number)
    }
  }

  /** 按 dirs.uri 的范围删除目录行；条目由外键级联删除（entries_fts 的删除触发器随之触发） */
  private removeSubtreeRows(uri: string): void {
    const dirs = subtreeCondition('uri', [uri])
    this.run(`DELETE FROM dirs WHERE ${dirs.sql}`, ...dirs.params)
  }

  /** 每个范围各取前 limit 条（合并后的前 limit 条必然在其中），合并去重后排序、截取 */
  private queue(kind: QueueKind, scopes: Scope[], limit: number, exclude?: Set<string>): string[] {
    if (limit <= 0) return []
    const found = new Map<string, number>()
    for (const sc of scopes) {
      const indexed = this.countInScope(sc) >= INDEX_SCAN_THRESHOLD
      const { sql, params } = queueQuery(kind, sc, limit, exclude, indexed)
      for (const r of this.all(sql, ...params)) found.set(r.uri as string, Number(r.key))
    }
    return [...found]
      .sort((a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
      .slice(0, limit)
      .map(([uri]) => uri)
  }

  /**
   * 范围内的目录数（数到 INDEX_SCAN_THRESHOLD 为止，成本有上限）。范围小时走主键范围 + 排序最快；
   * 范围大时必须按队列索引的顺序取，否则要读完范围内所有行再排序（30 万行约 250ms）。
   * 数的是范围大小而不是符合条件的行数：符合条件的行很少（例如浅层都已读完）时，
   * 数符合条件的行本身就要读完整个范围。
   */
  private countInScope(scope: Scope): number {
    const range = subtreeCondition('uri', [scope.uri])
    const r = this.get(
      `SELECT count(*) AS n FROM (SELECT 1 FROM dirs WHERE ${range.sql} LIMIT ?)`,
      ...range.params,
      INDEX_SCAN_THRESHOLD
    )
    return Number(r?.n ?? 0)
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
