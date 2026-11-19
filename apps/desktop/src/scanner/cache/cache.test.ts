import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Cache, isUnder, queueQuery } from './cache'
import type { RawEntry } from '../enum/types'

const file = (name: string, size = 1, mtime = 1000): RawEntry => ({
  name,
  kind: 'file',
  size,
  mtime,
  hidden: false
})
const dir = (name: string): RawEntry => ({
  name,
  kind: 'directory',
  size: 0,
  mtime: 1000,
  hidden: false
})
const DAY = 24 * 3600 * 1000

describe('isUnder', () => {
  it('matches the root itself and descendants', () => {
    expect(isUnder('file:///C:/a', 'file:///C:/a')).toBe(true)
    expect(isUnder('file:///C:/a/b/c', 'file:///C:/a')).toBe(true)
  })
  it('does not treat a sibling with a shared prefix as inside', () => {
    expect(isUnder('file:///C:/ab', 'file:///C:/a')).toBe(false)
    expect(isUnder('file:///C:/ab/c', 'file:///C:/a')).toBe(false)
  })
  it('handles drive roots that end with a slash', () => {
    expect(isUnder('file:///C:/', 'file:///C:/')).toBe(true)
    expect(isUnder('file:///C:/a', 'file:///C:/')).toBe(true)
    expect(isUnder('file:///D:/a', 'file:///C:/')).toBe(false)
  })
  it('handles UNC share roots', () => {
    expect(isUnder('file://server/share', 'file://server/share')).toBe(true)
    expect(isUnder('file://server/share/x', 'file://server/share')).toBe(true)
    expect(isUnder('file://server/share2', 'file://server/share')).toBe(false)
    expect(isUnder('file://server2/share/x', 'file://server/share')).toBe(false)
  })
  it('is case sensitive', () => {
    expect(isUnder('file:///C:/A/b', 'file:///C:/a')).toBe(false)
  })
})

describe('Cache', () => {
  let cache: Cache
  const A = 'file:///C:/a'
  beforeEach(() => {
    cache = Cache.open(':memory:')
    cache.setRoots([A])
  })
  afterEach(() => cache.close())

  it('applyListing reports changed on first write and when an entry differs, not when identical', () => {
    const list = [file('x.txt'), file('y.txt', 5)]
    expect(cache.applyListing(A, 111, list, 1000).changed).toBe(true)
    expect(cache.applyListing(A, 111, [...list], 2000).changed).toBe(false)
    expect(cache.getDir(A)).toMatchObject({
      parentUri: null,
      dirMtime: 111,
      listedAt: 2000,
      checkedAt: 2000,
      state: 'ok',
      errorCode: null
    })
    expect(cache.applyListing(A, 111, [file('x.txt'), file('y.txt', 6)], 3000).changed).toBe(true)
    expect(
      cache.applyListing(A, 111, [file('x.txt', 1, 1001), file('y.txt', 6)], 4000).changed
    ).toBe(true)
    expect(cache.applyListing(A, 111, [file('x.txt', 1, 1001)], 5000).changed).toBe(true)
    expect(
      cache.applyListing(A, 111, [{ ...file('x.txt', 1, 1001), hidden: true }], 6000).changed
    ).toBe(true)
    expect(cache.getEntries(A)).toEqual([{ ...file('x.txt', 1, 1001), hidden: true }])
  })

  it('round-trips symlink targets', () => {
    const links: RawEntry[] = [
      { name: 'l1', kind: 'symlink', target: 'directory', size: 0, mtime: 1, hidden: false },
      { name: 'l2', kind: 'symlink', target: null, size: 0, mtime: 1, hidden: false }
    ]
    cache.applyListing(A, 1, links, 1)
    expect(cache.getEntries(A)).toEqual(links)
    expect(cache.applyListing(A, 1, links, 2).changed).toBe(false)
    links[0] = { name: 'l1', kind: 'symlink', target: 'file', size: 0, mtime: 1, hidden: false }
    expect(cache.applyListing(A, 1, links, 3).changed).toBe(true)
  })

  it('applyListing creates child dir rows and removes rows of vanished child dirs (subtree)', () => {
    cache.applyListing(A, 1, [dir('b'), dir('日本語 c'), file('f')], 1)
    const b = 'file:///C:/a/b'
    expect(cache.childDirs(A).sort()).toEqual(
      [b, 'file:///C:/a/%E6%97%A5%E6%9C%AC%E8%AA%9E%20c'].sort()
    )
    expect(cache.getDir(b)).toMatchObject({ parentUri: A, listedAt: null, state: 'ok' })
    cache.applyListing(b, 2, [dir('deep'), file('g')], 2)
    cache.applyListing(`${b}/deep`, 3, [file('h')], 3)
    expect(cache.getEntries(`${b}/deep`)).toHaveLength(1)

    expect(cache.applyListing(A, 1, [file('f')], 4).changed).toBe(true)
    expect(cache.getDir(b)).toBeUndefined()
    expect(cache.getDir(`${b}/deep`)).toBeUndefined()
    expect(cache.getEntries(b)).toEqual([])
    expect(cache.getEntries(`${b}/deep`)).toEqual([])
    expect(cache.childDirs(A)).toEqual([])
  })

  it('applyListing ignores directories outside the configured roots', () => {
    expect(cache.applyListing('file:///C:/ab', 1, [file('x')], 1).changed).toBe(false)
    expect(cache.getDir('file:///C:/ab')).toBeUndefined()
    expect(cache.getEntries('file:///C:/ab')).toEqual([])
  })

  it('uses the same child URI as LocalProvider for drive roots', () => {
    cache.setRoots(['file:///C:/'])
    cache.applyListing('file:///C:/', 1, [dir('Users')], 1)
    expect(cache.childDirs('file:///C:/')).toEqual(['file:///C:/Users'])
    expect(cache.getDir('file:///C:/')?.parentUri).toBeNull()
  })

  it('prune keeps directories still under another root', () => {
    const B = 'file:///C:/a/b'
    cache.setRoots([A, B])
    cache.applyListing(A, 1, [dir('b')], 1)
    cache.applyListing(B, 1, [dir('c'), file('f')], 1)
    cache.applyListing(`${B}/c`, 1, [file('z')], 1)
    cache.setRoots([B])
    expect(cache.prune()).toBe(1)
    expect(cache.getDir(A)).toBeUndefined()
    expect(cache.getEntries(A)).toEqual([])
    expect(cache.getDir(B)).toBeDefined()
    expect(cache.getEntries(`${B}/c`)).toHaveLength(1)
    expect(cache.prune()).toBe(0)
  })

  it('prune does not treat a sibling with a shared prefix as inside the root', () => {
    cache.setRoots([A, 'file:///C:/ab'])
    cache.applyListing('file:///C:/ab', 1, [file('x')], 1)
    cache.setRoots([A])
    expect(cache.prune()).toBe(1)
    expect(cache.getDir('file:///C:/ab')).toBeUndefined()
  })

  it('markChecked and setState update the row', () => {
    expect(cache.setState(A, 'denied', 'FS_PERMISSION', 10).changed).toBe(true)
    expect(cache.setState(A, 'denied', 'FS_PERMISSION', 20).changed).toBe(false)
    expect(cache.getDir(A)).toMatchObject({
      state: 'denied',
      errorCode: 'FS_PERMISSION',
      checkedAt: 20
    })
    expect(cache.setState(A, 'unreachable', 'FS_UNAVAILABLE', 30).changed).toBe(true)
    cache.markChecked(A, 40)
    expect(cache.getDir(A)?.checkedAt).toBe(40)
    // 恢复后重新列出：状态回到 ok，视为变化
    expect(cache.applyListing(A, 1, [], 50).changed).toBe(true)
    expect(cache.getDir(A)).toMatchObject({ state: 'ok', errorCode: null })
    expect(cache.setState('file:///C:/other', 'denied', null, 1).changed).toBe(false)
    expect(cache.getDir('file:///C:/other')).toBeUndefined()
  })

  it('removeSubtree removes the directory and descendants but not prefix siblings', () => {
    cache.setRoots([A, 'file:///C:/ab'])
    cache.applyListing(A, 1, [dir('b')], 1)
    cache.applyListing(`${A}/b`, 1, [file('f')], 1)
    cache.applyListing('file:///C:/ab', 1, [file('x')], 1)
    cache.removeSubtree(A)
    expect(cache.getDir(A)).toBeUndefined()
    expect(cache.getDir(`${A}/b`)).toBeUndefined()
    expect(cache.getEntries(`${A}/b`)).toEqual([])
    expect(cache.getEntries('file:///C:/ab')).toHaveLength(1)
  })

  it('removeSubtree of a drive root removes the whole volume but not other volumes', () => {
    cache.setRoots(['file:///C:/', 'file:///D:/'])
    cache.applyListing('file:///C:/', 1, [dir('a')], 1)
    cache.applyListing('file:///C:/a', 1, [file('f')], 1)
    cache.applyListing('file:///D:/', 1, [dir('a')], 1)
    cache.removeSubtree('file:///C:/')
    expect(cache.getDir('file:///C:/')).toBeUndefined()
    expect(cache.getDir('file:///C:/a')).toBeUndefined()
    expect(cache.getEntries('file:///C:/a')).toEqual([])
    expect(cache.getDir('file:///D:/')).toBeDefined()
    expect(cache.childDirs('file:///D:/')).toEqual(['file:///D:/a'])
  })

  it('removeSubtree deletes through the primary key indexes (no full table scan)', () => {
    cache.applyListing(A, 1, [dir('b')], 1)
    const prepare = vi.spyOn(DatabaseSync.prototype, 'prepare')
    let sqls: string[]
    try {
      cache.removeSubtree(A)
      sqls = prepare.mock.calls.map(([sql]) => sql)
    } finally {
      prepare.mockRestore() // 同时清空 mock.calls：先取出
    }
    const deletes = sqls.filter((s) => /^DELETE/.test(s))
    expect(deletes).toHaveLength(2)
    for (const sql of deletes) {
      const n = (sql.match(/\?/g) ?? []).length
      const plan = cache
        .select(`EXPLAIN QUERY PLAN ${sql}`, ...Array<string>(n).fill(A))
        .map((r) => String(r.detail))
      expect(plan.join('\n'), sql).not.toMatch(/\bSCAN\b/)
      expect(plan.join('\n'), sql).toMatch(/USING .*INDEX/)
    }
  })

  describe('queue queries', () => {
    // A 下：b（已读，含 b1、b2）、c（未读）、d（未读，含不在范围内的前缀兄弟 A+"x"）
    const B = 'file:///C:/a/b'
    const C = 'file:///C:/a/c'
    const D = 'file:///C:/a/d'
    beforeEach(() => {
      cache.setRoots([A, 'file:///C:/ax', 'file:///C:/'])
      cache.applyListing(A, 1, [dir('b'), dir('c'), dir('d')], 100)
      cache.applyListing(B, 1, [dir('b1'), dir('b2')], 300)
      cache.applyListing('file:///C:/a/b/b1', 1, [dir('deep')], 200)
      cache.applyListing('file:///C:/ax', 1, [dir('y')], 50)
    })

    it('nextUnlisted returns unlisted directories in scope, shallow first then by uri', () => {
      expect(cache.nextUnlisted([{ uri: A, maxDepth: null }], 10)).toEqual([
        C,
        D,
        'file:///C:/a/b/b2',
        'file:///C:/a/b/b1/deep'
      ])
      expect(cache.nextUnlisted([{ uri: A, maxDepth: null }], 2)).toEqual([C, D])
    })

    it('nextUnlisted honours maxDepth relative to the scope uri', () => {
      expect(cache.nextUnlisted([{ uri: A, maxDepth: 0 }], 10)).toEqual([])
      expect(cache.nextUnlisted([{ uri: A, maxDepth: 1 }], 10)).toEqual([C, D])
      expect(cache.nextUnlisted([{ uri: B, maxDepth: 0 }], 10)).toEqual([])
      expect(cache.nextUnlisted([{ uri: B, maxDepth: 1 }], 10)).toEqual(['file:///C:/a/b/b2'])
      expect(cache.nextUnlisted([{ uri: 'file:///C:/a/b/b1', maxDepth: 1 }], 10)).toEqual([
        'file:///C:/a/b/b1/deep'
      ])
    })

    it('maxDepth 0 includes the scope itself when it is unlisted', () => {
      expect(cache.nextUnlisted([{ uri: C, maxDepth: 0 }], 10)).toEqual([C])
    })

    it('does not include prefix siblings of the scope', () => {
      expect(cache.nextUnlisted([{ uri: A, maxDepth: null }], 10)).not.toContain('file:///C:/ax/y')
      expect(cache.oldestChecked([{ uri: A, maxDepth: null }], 10)).not.toContain('file:///C:/ax')
    })

    it('counts depth correctly for a drive root scope', () => {
      cache.applyListing('file:///C:/', 1, [dir('x'), dir('a')], 10)
      cache.applyListing('file:///C:/x', 1, [dir('z')], 10)
      expect(cache.nextUnlisted([{ uri: 'file:///C:/', maxDepth: 0 }], 10)).toEqual([])
      expect(cache.nextUnlisted([{ uri: 'file:///C:/', maxDepth: 1 }], 10)).toEqual([])
      cache.applyListing('file:///C:/', 1, [dir('x'), dir('a'), dir('q')], 10)
      expect(cache.nextUnlisted([{ uri: 'file:///C:/', maxDepth: 1 }], 10)).toEqual([
        'file:///C:/q'
      ])
      expect(cache.nextUnlisted([{ uri: 'file:///C:/', maxDepth: 2 }], 10)).toContain(
        'file:///C:/x/z'
      )
      expect(cache.nextUnlisted([{ uri: 'file:///C:/', maxDepth: 1 }], 10)).not.toContain(
        'file:///C:/x/z'
      )
    })

    it('merges several scopes without duplicates and limits the merged total', () => {
      const scopes = [
        { uri: A, maxDepth: 1 },
        { uri: A, maxDepth: null },
        { uri: B, maxDepth: null }
      ]
      expect(cache.nextUnlisted(scopes, 10)).toEqual([
        C,
        D,
        'file:///C:/a/b/b2',
        'file:///C:/a/b/b1/deep'
      ])
      expect(cache.nextUnlisted(scopes, 3)).toEqual([C, D, 'file:///C:/a/b/b2'])
      expect(cache.nextUnlisted([], 5)).toEqual([])
      expect(cache.nextUnlisted(scopes, 0)).toEqual([])
    })

    it('exclude removes URIs from both queries', () => {
      expect(cache.nextUnlisted([{ uri: A, maxDepth: 1 }], 10, new Set([C]))).toEqual([D])
      expect(cache.oldestChecked([{ uri: A, maxDepth: null }], 10, new Set([A]))).not.toContain(A)
    })

    it('oldestChecked returns listed directories by checked_at ascending, NULL oldest', () => {
      // A=100, b=300, b1=200（均已读）；c、d 未读不出现
      expect(cache.oldestChecked([{ uri: A, maxDepth: null }], 10)).toEqual([
        A,
        'file:///C:/a/b/b1',
        B
      ])
      expect(cache.oldestChecked([{ uri: A, maxDepth: null }], 2)).toEqual([A, 'file:///C:/a/b/b1'])
      expect(cache.oldestChecked([{ uri: A, maxDepth: 1 }], 10)).toEqual([A, B])
      cache.markChecked(B, 50)
      expect(cache.oldestChecked([{ uri: A, maxDepth: null }], 1)).toEqual([B])
    })

    it('a directory that failed to read leaves nextUnlisted and joins oldestChecked by its failure time', () => {
      cache.setState(C, 'denied', 'EPERM', 150)
      expect(cache.nextUnlisted([{ uri: A, maxDepth: 1 }], 10)).toEqual([D])
      expect(cache.oldestChecked([{ uri: A, maxDepth: 1 }], 10)).toEqual([A, C, B])
      expect(cache.getDir(C)?.listedAt).toBeNull()
    })

    it('markChecked also takes a never-attempted directory out of nextUnlisted', () => {
      cache.markChecked(D, 10)
      expect(cache.nextUnlisted([{ uri: A, maxDepth: 1 }], 10)).toEqual([C])
      expect(cache.oldestChecked([{ uri: A, maxDepth: 1 }], 1)).toEqual([D])
    })

    it('both query shapes are index driven (no full scan, no sort over the whole range)', () => {
      const scope = { uri: A, maxDepth: 3 }
      for (const kind of ['unlisted', 'checked'] as const) {
        const small = queueQuery(kind, scope, 5, new Set([C]), false)
        const smallPlan = cache
          .select(`EXPLAIN QUERY PLAN ${small.sql}`, ...small.params)
          .map((r) => String(r.detail))
          .join('\n')
        expect(smallPlan, kind).not.toMatch(/SCAN dirs(?! USING)/)
        expect(smallPlan, kind).toMatch(/SEARCH dirs USING .*INDEX/)

        const big = queueQuery(kind, scope, 5, new Set([C]), true)
        const bigPlan = cache
          .select(`EXPLAIN QUERY PLAN ${big.sql}`, ...big.params)
          .map((r) => String(r.detail))
          .join('\n')
        expect(bigPlan, kind).toMatch(kind === 'unlisted' ? /dirs_unlisted/ : /dirs_checked/)
        expect(bigPlan, kind).not.toMatch(/TEMP B-TREE/)
      }
    })
  })

  describe('queue queries on 50k rows', () => {
    let big: Cache
    beforeEach(() => {
      big = Cache.open(':memory:')
      const db = (big as unknown as { db: DatabaseSync }).db
      const ins = db.prepare(
        "INSERT INTO dirs (uri, listed_at, checked_at, state) VALUES (?, 1, ?, 'ok')"
      )
      db.exec('BEGIN')
      for (let i = 0; i < 50000; i++) {
        const checked = i % 3 === 0 ? null : (i * 7919) % 1000003
        ins.run(`file:///C:/r${i % 50}/d${i % 1000}/e${i}`, checked)
      }
      db.exec('COMMIT')
    })
    afterEach(() => big.close())

    const ms = (fn: () => unknown): number => {
      fn()
      const t = performance.now()
      for (let i = 0; i < 20; i++) fn()
      return (performance.now() - t) / 20
    }
    const LIMIT_MS = 20

    it('whole-volume and subtree queries stay fast and return the right rows', () => {
      const whole = [{ uri: 'file:///C:/', maxDepth: null }]
      const deep = [{ uri: 'file:///C:/', maxDepth: 5 }]
      const sub = [{ uri: 'file:///C:/r7', maxDepth: null }]
      const prepare = vi.spyOn(DatabaseSync.prototype, 'prepare')
      let sqls: string[]
      try {
        big.nextUnlisted(whole, 20)
        big.oldestChecked(whole, 20)
        big.nextUnlisted(sub, 20)
        big.oldestChecked(sub, 20)
        sqls = prepare.mock.calls.map(([sql]) => sql)
      } finally {
        prepare.mockRestore()
      }
      // 整卷用 INDEXED BY，子树（约 1000 行）走主键范围
      expect(sqls.filter((q) => /INDEXED BY dirs_unlisted/.test(q))).toHaveLength(1)
      expect(sqls.filter((q) => /INDEXED BY dirs_checked/.test(q))).toHaveLength(1)

      const timings = {
        unlistedWhole: ms(() => big.nextUnlisted(whole, 20)),
        checkedWhole: ms(() => big.oldestChecked(whole, 20)),
        unlistedDeep: ms(() => big.nextUnlisted(deep, 20)),
        checkedDeep: ms(() => big.oldestChecked(deep, 20)),
        unlistedSub: ms(() => big.nextUnlisted(sub, 20)),
        checkedSub: ms(() => big.oldestChecked(sub, 20))
      }
      for (const [name, t] of Object.entries(timings)) expect(t, name).toBeLessThan(LIMIT_MS)

      // 结果与暴力计算一致
      const rows = big.select('SELECT uri, checked_at FROM dirs').map((r) => ({
        uri: r.uri as string,
        at: r.checked_at as number | null
      }))
      const oldest = rows
        .filter((r) => r.at !== null)
        .sort((a, b) => a.at! - b.at! || (a.uri < b.uri ? -1 : 1))
        .slice(0, 20)
        .map((r) => r.uri)
      expect(big.oldestChecked(whole, 20)).toEqual(oldest)
      const top = big.nextUnlisted(whole, 20)
      expect(top).toHaveLength(20)
      expect(top).toEqual([...top].sort())
    })
  })

  it('visit decays scores with a three day half-life and hot returns the top k', () => {
    cache.applyListing(A, 1, [dir('x'), dir('y'), dir('z')], 0)
    const [x, y, z] = [`${A}/x`, `${A}/y`, `${A}/z`] as [string, string, string]
    cache.visit(x, 0)
    cache.visit(x, 0) // 2
    cache.visit(y, 0)
    cache.visit(y, 3 * DAY) // 0.5 + 1 = 1.5
    cache.visit(z, 6 * DAY) // 1，但最近
    expect(cache.getDir(x)?.visitScore).toBeCloseTo(2)
    expect(cache.getDir(y)?.visitScore).toBeCloseTo(1.5)
    expect(cache.getDir(z)?.visitScore).toBeCloseTo(1)
    // 折算到 6 天时刻：x = 2·0.25 = 0.5，y = 1.5·0.5 = 0.75，z = 1
    expect(cache.hot(2)).toEqual([z, y])
    expect(cache.hot(10)).toEqual([z, y, x])
    expect(cache.hot(0)).toEqual([])
  })

  it('sizeBytes reports a positive size and clear empties the cache', () => {
    cache.applyListing(A, 1, [file('x')], 1)
    expect(cache.sizeBytes()).toBeGreaterThan(0)
    cache.clear()
    expect(cache.getDir(A)).toBeUndefined()
    expect(cache.getEntries(A)).toEqual([])
  })
})

describe('Cache on disk', () => {
  let tmp: string
  /** 本测试打开的连接：断言失败时也在 afterEach 中关闭（否则 Windows 上临时目录删不掉） */
  let opened: { close(): void }[]
  const track = <T extends { close(): void }>(x: T): T => {
    opened.push(x)
    return x
  }
  beforeEach(() => {
    tmp = mkdtempSync(path.join(tmpdir(), 'pch-cache-'))
    opened = []
  })
  afterEach(() => {
    for (const x of opened) {
      try {
        x.close()
      } catch {
        // 测试中已关闭
      }
    }
    // 句柄刚关闭时删除可能暂时 EBUSY；force 只忽略 ENOENT，需要重试
    rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  })

  it('entries_fts finds 第10章 in 設計書_第10章.xlsx after applyListing and forgets it after removal', () => {
    const f = path.join(tmp, 'sub', 'index.db')
    const cache = track(Cache.open(f))
    const A = 'file:///C:/a'
    cache.setRoots([A])
    cache.applyListing(A, 1, [file('設計書_第10章.xlsx'), file('other.txt')], 1)
    const probe = track(new DatabaseSync(f))
    const hits = (q: string): unknown[] =>
      probe
        .prepare(
          'SELECT e.name FROM entries_fts f JOIN entries e ON e.rowid = f.rowid WHERE entries_fts MATCH ?'
        )
        .all(q)
        .map((r) => r.name)
    expect(hits('第10章')).toEqual(['設計書_第10章.xlsx'])
    cache.applyListing(A, 1, [file('設計書_第10章.xlsx', 9), file('other.txt')], 2)
    expect(hits('第10章')).toEqual(['設計書_第10章.xlsx'])
    cache.applyListing(A, 1, [file('other.txt')], 3)
    expect(hits('第10章')).toEqual([])
    cache.applyListing(A, 1, [file('設計書_第10章.xlsx')], 4)
    expect(hits('第10章')).toEqual(['設計書_第10章.xlsx'])
    cache.removeSubtree(A)
    expect(hits('第10章')).toEqual([])
    probe.close()
    cache.close()
  })

  it('open rebuilds the database when user_version differs', () => {
    const f = path.join(tmp, 'index.db')
    const old = track(new DatabaseSync(f))
    old.exec(
      "CREATE TABLE dirs (junk TEXT); INSERT INTO dirs VALUES ('x'); PRAGMA user_version = 999"
    )
    old.close()
    const cache = track(Cache.open(f))
    cache.setRoots(['file:///C:/a'])
    expect(cache.applyListing('file:///C:/a', 1, [file('x')], 1).changed).toBe(true)
    cache.close()
    const probe = track(new DatabaseSync(f))
    expect(probe.prepare('PRAGMA user_version').get()?.user_version).not.toBe(999)
    probe.close()
    // 版本一致时数据保留
    const again = track(Cache.open(f))
    again.setRoots(['file:///C:/a'])
    expect(again.getEntries('file:///C:/a')).toHaveLength(1)
    again.close()
  })

  it('open closes the database when the file is not a database (so it can be deleted)', () => {
    const f = path.join(tmp, 'index.db')
    writeFileSync(f, 'not a sqlite database '.repeat(200))
    expect(() => Cache.open(f)).toThrow(/not a database/)
    expect(() => rmSync(f)).not.toThrow()
  })
})
