import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Cache, childUri, isUnder, queueQuery } from './cache'
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

  it('nested roots: listing the inner root keeps the parent_id set by the outer listing', () => {
    const B = 'file:///C:/a/b'
    cache.setRoots([A, B])
    cache.applyListing(A, 1, [dir('b')], 1)
    expect(cache.getDir(B)?.parentUri).toBe(A)
    cache.applyListing(B, 1, [file('x')], 2)
    expect(cache.getDir(B)?.parentUri).toBe(A)
    expect(cache.childDirs(A)).toEqual([B])
    cache.applyListing(A, 2, [dir('b')], 3)
    expect(cache.childDirs(A)).toEqual([B])
  })

  it('prune clears parent_id left dangling so a re-created parent adopts the row', () => {
    const B = 'file:///C:/a/b'
    cache.setRoots([A])
    cache.applyListing(A, 1, [dir('b')], 1)
    cache.applyListing(B, 1, [dir('c')], 1)
    cache.setRoots([B])
    expect(cache.prune()).toBe(1)
    expect(cache.getDir(B)?.parentUri).toBeNull()
    cache.setRoots([A])
    cache.visit(A, 5) // A 的行重新建立：认领 B
    expect(cache.childDirs(A)).toEqual([B])
    cache.applyListing(A, 2, [], 6) // 列表中不再有 b：B 的子树被删除
    expect(cache.getDir(B)).toBeUndefined()
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

  it('applyListing makes a not-found child directory never-attempted again (checked_at NULL)', () => {
    const B = `${A}/b`
    cache.applyListing(A, 1, [dir('b')], 10)
    cache.applyListing(B, 1, [file('c.txt')], 10)
    cache.setState(B, 'not-found', 'FS_NOT_FOUND', 20)
    expect(cache.getDir(B)).toMatchObject({ state: 'not-found', checkedAt: 20 })
    // 父目录再次列出 b：b 成为「从未尝试过」，后台队列与定期确认会尽快重新读取
    cache.applyListing(A, 2, [dir('b')], 30)
    expect(cache.getDir(B)).toMatchObject({ state: 'not-found', checkedAt: null })
    expect(cache.nextUnlisted([{ uri: A, maxDepth: null }], 10)).toEqual([B])
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

  it('removeMissing also removes the directory from its parent listing, but not a symlink', () => {
    cache.setRoots([A])
    const link: RawEntry = { ...dir('l'), kind: 'symlink', target: 'directory' }
    cache.applyListing(A, 1, [dir('b'), file('f'), link], 1)
    cache.applyListing(`${A}/b`, 1, [file('x')], 1)
    cache.applyListing(`${A}/l`, 1, [file('y')], 1)
    expect(cache.removeMissing(`${A}/b`)).toEqual({ parentChanged: true })
    expect(cache.getDir(`${A}/b`)).toBeUndefined()
    expect(cache.getEntries(`${A}/b`)).toEqual([])
    expect(cache.getEntries(A).map((e) => e.name)).toEqual(['f', 'l'])
    // 目标不在的符号链接本身仍在父目录中：只删除它的缓存
    expect(cache.removeMissing(`${A}/l`)).toEqual({ parentChanged: false })
    expect(cache.getDir(`${A}/l`)).toBeUndefined()
    expect(cache.getEntries(A).map((e) => e.name)).toEqual(['f', 'l'])
    // 根：没有父目录的列表
    expect(cache.removeMissing(A)).toEqual({ parentChanged: false })
    expect(cache.getDir(A)).toBeUndefined()
  })

  it('removeMissing invalidates the parent mtime only when it removed the parent entry', () => {
    // 从父目录列表中删除该项是推断：父目录下一次确认必须完整读取（修改时间可能没有变，例如上级改名后改回）
    cache.setRoots([A])
    const link: RawEntry = { ...dir('l'), kind: 'symlink', target: 'directory' }
    cache.applyListing(A, 7, [dir('b'), link], 1)
    cache.applyListing(`${A}/b`, 3, [file('x')], 1)
    cache.applyListing(`${A}/l`, 4, [], 1)
    cache.removeMissing(`${A}/l`)
    expect(cache.getDir(A)?.dirMtime).toBe(7)
    cache.removeMissing(`${A}/b`)
    expect(cache.getDir(A)).toMatchObject({ dirMtime: null, listedAt: 1, state: 'ok' })
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
    // 条目由外键级联删除，只需要删 dirs
    expect(deletes).toHaveLength(1)
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

  it('hot reads only the visited directories through a partial index (no full table scan)', () => {
    cache.applyListing(A, 1, [dir('x'), dir('y')], 0)
    cache.visit(`${A}/x`, 0)
    const prepare = vi.spyOn(DatabaseSync.prototype, 'prepare')
    let sqls: string[]
    try {
      expect(cache.hot(5)).toEqual([`${A}/x`])
      sqls = prepare.mock.calls.map(([sql]) => sql)
    } finally {
      prepare.mockRestore()
    }
    expect(sqls).toHaveLength(1)
    const plan = cache
      .select(`EXPLAIN QUERY PLAN ${sqls[0]!}`)
      .map((r) => String(r.detail))
      .join('\n')
    expect(plan).toMatch(/USING (COVERING )?INDEX dirs_hot\b/)
  })

  describe('integer directory ids', () => {
    const rows = (sql: string): Record<string, unknown>[] => cache.select(sql)
    const count = (sql: string): number => Number(rows(sql)[0]?.n)
    /** 每个 entries 行都属于现存目录，且 entries_fts 与 entries 一致（external content 的完整性检查） */
    const expectConsistent = (): void => {
      expect(
        count('SELECT count(*) AS n FROM entries WHERE dir_id NOT IN (SELECT id FROM dirs)')
      ).toBe(0)
      // entries_fts_docsize 是 FTS 自己维护的行记录（external content 表的全表扫描读的是 entries，不能用来对账）
      expect(count('SELECT count(*) AS n FROM entries_fts_docsize')).toBe(
        count('SELECT count(*) AS n FROM entries')
      )
      expect(() =>
        rows("INSERT INTO entries_fts(entries_fts, rank) VALUES ('integrity-check', 1)")
      ).not.toThrow()
    }

    it('references directories by integer id: no TEXT directory reference in entries or dirs', () => {
      const entryCols = rows('PRAGMA table_info(entries)').map((c) => [c.name, c.type])
      expect(entryCols).toContainEqual(['dir_id', 'INTEGER'])
      expect(entryCols.map((c) => c[0])).not.toContain('dir_uri')
      const dirCols = rows('PRAGMA table_info(dirs)').map((c) => [c.name, c.type])
      expect(dirCols).toContainEqual(['id', 'INTEGER'])
      expect(dirCols).toContainEqual(['parent_id', 'INTEGER'])
      expect(dirCols.map((c) => c[0])).not.toContain('parent_uri')
      expect(rows('PRAGMA foreign_keys')[0]?.foreign_keys).toBe(1)
    })

    it('getDir still reports the parent as a URI and childDirs resolves through parent_id', () => {
      cache.applyListing(A, 1, [dir('b')], 1)
      cache.applyListing(`${A}/b`, 1, [dir('c')], 1)
      expect(cache.getDir(`${A}/b`)?.parentUri).toBe(A)
      expect(cache.getDir(A)?.parentUri).toBeNull()
      expect(cache.childDirs(A)).toEqual([`${A}/b`])
      expect(cache.childDirs(`${A}/b`)).toEqual([`${A}/b/c`])
      expect(cache.childDirs('file:///C:/nowhere')).toEqual([])
    })

    it('removeSubtree / removeMissing / prune leave no entries or entries_fts rows of the removed directories', () => {
      const B = 'file:///C:/ab'
      cache.setRoots([A, B])
      cache.applyListing(A, 1, [dir('s'), dir('t'), file('keep-root.txt')], 1)
      cache.applyListing(`${A}/s`, 1, [dir('u'), file('gone-s.txt')], 1)
      cache.applyListing(`${A}/s/u`, 1, [file('gone-u.txt')], 1)
      cache.applyListing(`${A}/t`, 1, [dir('v'), file('gone-t.txt')], 1)
      cache.applyListing(`${A}/t/v`, 1, [file('gone-v.txt')], 1)
      cache.applyListing(B, 1, [file('gone-b.txt')], 1)
      expectConsistent()
      const ftsHits = (q: string): number =>
        count(`SELECT count(*) AS n FROM entries_fts WHERE entries_fts MATCH '"${q}"'`)

      cache.removeSubtree(`${A}/s`)
      expect(cache.getEntries(`${A}/s`)).toEqual([])
      expect(cache.getEntries(`${A}/s/u`)).toEqual([])
      expect(ftsHits('gone-s')).toBe(0)
      expect(ftsHits('gone-u')).toBe(0)
      expect(ftsHits('gone-t')).toBe(1)
      expectConsistent()

      cache.removeMissing(`${A}/t`)
      expect(ftsHits('gone-t')).toBe(0)
      expect(ftsHits('gone-v')).toBe(0)
      expect(ftsHits('keep-root')).toBe(1)
      expectConsistent()

      cache.setRoots([A])
      expect(cache.prune()).toBe(1)
      expect(ftsHits('gone-b')).toBe(0)
      expect(ftsHits('keep-root')).toBe(1)
      expectConsistent()
      expect(count('SELECT count(*) AS n FROM entries')).toBe(
        count("SELECT count(*) AS n FROM entries WHERE name IN ('keep-root.txt', 's', 't')")
      )
    })

    it('a directory removed and recreated under the same URI gets a new id and none of the old entries', () => {
      cache.applyListing(A, 1, [dir('p')], 1)
      cache.applyListing(`${A}/p`, 1, [dir('q'), file('old.txt')], 1)
      cache.applyListing(`${A}/p/q`, 1, [file('old-q.txt')], 1)
      const idOf = (uri: string): number =>
        Number(cache.select('SELECT id FROM dirs WHERE uri = ?', uri)[0]?.id)
      const oldId = idOf(`${A}/p`)
      const oldQ = idOf(`${A}/p/q`)

      cache.removeSubtree(`${A}/p`)
      cache.applyListing(A, 2, [dir('p')], 2)
      expect(idOf(`${A}/p`)).not.toBe(oldId)
      cache.applyListing(`${A}/p`, 2, [dir('q'), file('new.txt')], 2)
      expect(idOf(`${A}/p/q`)).not.toBe(oldQ)
      expect(cache.getEntries(`${A}/p`).map((e) => e.name)).toEqual(['new.txt', 'q'])
      expect(cache.getEntries(`${A}/p/q`)).toEqual([])
      expect(count(`SELECT count(*) AS n FROM entries WHERE dir_id IN (${oldId}, ${oldQ})`)).toBe(0)
      expectConsistent()
    })

    it('a deep directory visited before its ancestors is adopted by the ancestors once they exist', () => {
      cache.visit(`${A}/x/y`, 1)
      expect(cache.getDir(`${A}/x/y`)?.parentUri).toBe(`${A}/x`) // 父目录行还不存在：回落到字符串方式
      cache.visit(`${A}/x`, 2)
      expect(cache.childDirs(`${A}/x`)).toEqual([`${A}/x/y`])
      cache.applyListing(A, 1, [dir('x')], 3)
      cache.applyListing(`${A}/x`, 1, [dir('y'), dir('z')], 3)
      expect(cache.childDirs(`${A}/x`).sort()).toEqual([`${A}/x/y`, `${A}/x/z`])
      expect(cache.childDirs(A)).toEqual([`${A}/x`])
      // 不会为已有的行烧掉编号（冲突的插入会消耗 AUTOINCREMENT）
      const before = Number(cache.select('SELECT seq FROM sqlite_sequence')[0]?.seq)
      for (let i = 0; i < 3; i++) cache.applyListing(`${A}/x`, 1, [dir('y'), dir('z')], 4 + i)
      expect(Number(cache.select('SELECT seq FROM sqlite_sequence')[0]?.seq)).toBe(before)
    })

    it('removing a vanished child directory through applyListing cascades its entries', () => {
      cache.applyListing(A, 1, [dir('b')], 1)
      cache.applyListing(`${A}/b`, 1, [file('x.txt')], 1)
      cache.applyListing(A, 2, [], 2)
      expect(cache.getDir(`${A}/b`)).toBeUndefined()
      expect(count('SELECT count(*) AS n FROM entries')).toBe(0)
      expectConsistent()
    })
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

  it('open drops and recreates the tables directly when user_version differs from an AUTOINCREMENT database', () => {
    const f = path.join(tmp, 'index.db')
    const first = track(Cache.open(f))
    first.setRoots(['file:///C:/a'])
    first.applyListing('file:///C:/a', 1, [dir('b'), file('x')], 1)
    first.close()
    const old = track(new DatabaseSync(f))
    old.exec('PRAGMA user_version = 4')
    old.close()
    // 不经「打开失败 → 删除文件重建」的兜底：直接 Cache.open 必须成功并得到空库，编号从 1 开始
    const again = track(Cache.open(f))
    again.setRoots(['file:///C:/a'])
    expect(again.getDir('file:///C:/a')).toBeUndefined()
    again.applyListing('file:///C:/a', 1, [], 2)
    expect(again.select('SELECT id FROM dirs')).toEqual([{ id: 1 }])
    again.close()
  })

  it('open closes the database when the file is not a database (so it can be deleted)', () => {
    const f = path.join(tmp, 'index.db')
    writeFileSync(f, 'not a sqlite database '.repeat(200))
    expect(() => Cache.open(f)).toThrow(/not a database/)
    expect(() => rmSync(f)).not.toThrow()
  })
})

describe('Cache: sftp URIs', () => {
  const S = 'sftp://ID/a'
  const C = 'sftp://ID/a/b%20c'

  it('childUri encodes names', () => {
    expect(childUri(S, 'b c')).toBe(C)
  })

  it('applyListing links child directories to their parent', () => {
    const cache = Cache.open(':memory:')
    cache.setRoots([S])
    cache.applyListing(S, 1, [dir('b c')], 1)
    cache.applyListing(C, 1, [], 2)
    expect(cache.getDir(C)?.parentUri).toBe(S)
    cache.close()
  })

  it('removeMissing deletes the entry from the parent listing', () => {
    const cache = Cache.open(':memory:')
    cache.setRoots([S])
    cache.applyListing(S, 1, [dir('b c'), dir('d')], 1)
    cache.applyListing(C, 1, [], 2)
    expect(cache.removeMissing(C).parentChanged).toBe(true)
    expect(cache.getEntries(S).map((e) => e.name)).toEqual(['d'])
    cache.close()
  })
})
