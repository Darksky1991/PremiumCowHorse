import { afterEach, describe, expect, it } from 'vitest'
import { sql } from 'kysely'
import type { DesktopItem } from '@pch/shared'
import type { Logger } from '../../infra/logger'
import { openDatabase, type Database } from '../../infra/db/client'
import { DesktopSnapshotRepo } from './snapshot.repo'

const noop = (): void => undefined
const silent: Logger = { error: noop, warn: noop, info: noop, debug: noop }

const dbs: Database[] = []
afterEach(async () => {
  await Promise.all(dbs.splice(0).map((d) => d.destroy()))
})
async function memoryDb(): Promise<Database> {
  const db = await openDatabase(':memory:', silent)
  dbs.push(db)
  return db
}

const explorer = (p: string): DesktopItem => ({ kind: 'explorer', tabs: [p], bounds: null })
const byNumber = (x: number, y: number): number => x - y

describe('DesktopSnapshotRepo', () => {
  it('only sees snapshots of this machine', async () => {
    const db = await memoryDb()
    const a = new DesktopSnapshotRepo(db, 'PC-A')
    const b = new DesktopSnapshotRepo(db, 'PC-B')
    const idA = await a.insert({
      kind: 'auto',
      createdAt: 10,
      logonAt: 1,
      items: [explorer('C:\\a')]
    })
    const idB = await b.insert({
      kind: 'auto',
      createdAt: 20,
      logonAt: 1,
      items: [explorer('C:\\b')]
    })

    expect((await a.list()).map((s) => s.id)).toEqual([idA])
    expect((await b.list()).map((s) => s.id)).toEqual([idB])
    expect(await a.get(idB)).toBeNull()
    expect((await a.listByLogon()).map((s) => s.id)).toEqual([idA])
    // 别的机器的快照不能被改名 / 删除 / 清理
    await a.rename(idB, 'x')
    await a.delete(idB)
    await a.prune(0, null)
    await a.deleteAll()
    expect(await a.updateAuto(idB, { createdAt: 99, items: [] })).toBe(false)
    expect((await b.get(idB))?.name).toBeNull()
  })

  it('round-trips items in order with itemCount, name and kind', async () => {
    const db = await memoryDb()
    const repo = new DesktopSnapshotRepo(db, 'PC-A')
    const items = [
      { kind: 'explorer', tabs: ['C:\\a', 'C:\\a2', 'C:\\a3'], bounds: null },
      { kind: 'office', app: 'excel', path: 'C:\\b.xlsx', readOnly: false, exe: 'EXCEL.EXE' },
      { kind: 'eclipse', workspace: 'C:\\ws', exe: 'eclipse.exe', bounds: null }
    ] satisfies DesktopItem[]
    const id = await repo.insert({ kind: 'manual', createdAt: 5, logonAt: 2, name: 'n', items })
    await repo.insert({ kind: 'auto', createdAt: 6, logonAt: 2, items: [] })

    const snap = await repo.get(id)
    expect(snap).toMatchObject({
      id,
      kind: 'manual',
      createdAt: 5,
      logonAt: 2,
      name: 'n',
      // Explorer 每个标签算一项：3 + 1 + 1
      itemCount: 5
    })
    expect(snap?.items.map((i) => i.item)).toEqual(items)
    const list = await repo.list()
    expect(list.map((s) => [s.createdAt, s.itemCount])).toEqual([
      [6, 0],
      [5, 5]
    ])

    await repo.rename(id, null)
    expect((await repo.get(id))?.name).toBeNull()
    await repo.delete(id)
    expect(await repo.get(id)).toBeNull()
  })

  it('list excludes exit-none but listByLogon includes it', async () => {
    const db = await memoryDb()
    const repo = new DesktopSnapshotRepo(db, 'PC-A')
    await repo.insert({ kind: 'auto', createdAt: 1, logonAt: 1, items: [] })
    const none = await repo.insert({ kind: 'exit-none', createdAt: 2, logonAt: 1, items: [] })
    expect((await repo.list()).map((s) => s.kind)).toEqual(['auto'])
    expect((await repo.listByLogon()).map((s) => s.id)).toContain(none)
  })

  it('get drops items whose data is invalid', async () => {
    const db = await memoryDb()
    const repo = new DesktopSnapshotRepo(db, 'PC-A')
    const id = await repo.insert({
      kind: 'auto',
      createdAt: 1,
      logonAt: 1,
      items: [explorer('C:\\a')]
    })
    await sql`insert into desktop_items (snapshot_id, sort, data) values (${id}, 1, 'not json'), (${id}, 2, '{"kind":"explorer"}'), (${id}, 3, '{"kind":"unknown"}')`.execute(
      db
    )
    const snap = await repo.get(id)
    expect(snap?.items).toHaveLength(1)
    expect(snap?.items[0]?.item).toEqual(explorer('C:\\a'))
  })

  async function seed(
    repo: DesktopSnapshotRepo,
    kinds: ('auto' | 'manual' | 'exit' | 'exit-none')[]
  ): Promise<number[]> {
    const ids: number[] = []
    for (const [i, kind] of kinds.entries()) {
      ids.push(await repo.insert({ kind, createdAt: 100 + i, logonAt: 1, items: [] }))
    }
    return ids
  }

  it('prune(3, null) keeps the newest 3 visible snapshots and the newest exit-none', async () => {
    const db = await memoryDb()
    const repo = new DesktopSnapshotRepo(db, 'PC-A')
    // 创建顺序：auto, none, manual, exit, auto, none, manual（5 个可见 + 2 个 exit-none）
    const ids = await seed(repo, [
      'auto',
      'exit-none',
      'manual',
      'exit',
      'auto',
      'exit-none',
      'manual'
    ])
    await repo.prune(3, null)
    expect((await repo.listByLogon()).map((s) => s.id).sort(byNumber)).toEqual(
      [ids[3]!, ids[4]!, ids[5]!, ids[6]!].sort(byNumber)
    )
  })

  it('prune keeps the protected snapshot even when it is the oldest, total stays 3', async () => {
    const db = await memoryDb()
    const repo = new DesktopSnapshotRepo(db, 'PC-A')
    const ids = await seed(repo, ['exit', 'manual', 'manual', 'auto', 'manual'])
    await repo.prune(3, ids[0]!)
    expect((await repo.list()).map((s) => s.id).sort(byNumber)).toEqual(
      [ids[0]!, ids[3]!, ids[4]!].sort(byNumber)
    )
  })

  it('prune with a protectId that no longer exists behaves like null', async () => {
    const db = await memoryDb()
    const repo = new DesktopSnapshotRepo(db, 'PC-A')
    const ids = await seed(repo, ['manual', 'manual', 'manual', 'manual'])
    await repo.prune(3, 9999)
    expect((await repo.list()).map((s) => s.id).sort(byNumber)).toEqual(ids.slice(1))
  })

  it('updateAuto replaces the items and created_at of an auto; refuses other kinds', async () => {
    const db = await memoryDb()
    const repo = new DesktopSnapshotRepo(db, 'PC-A')
    const auto = await repo.insert({
      kind: 'auto',
      createdAt: 1,
      logonAt: 5,
      items: [explorer('C:\\old1'), explorer('C:\\old2')]
    })
    const manual = await repo.insert({ kind: 'manual', createdAt: 2, logonAt: 5, items: [] })
    expect(await repo.updateAuto(auto, { createdAt: 50, items: [explorer('C:\\new')] })).toBe(true)
    const snap = await repo.get(auto)
    expect(snap).toMatchObject({ createdAt: 50, logonAt: 5, itemCount: 1 })
    expect(snap?.items.map((i) => i.item)).toEqual([explorer('C:\\new')])
    expect(await repo.updateAuto(manual, { createdAt: 60, items: [] })).toBe(false)
    expect((await repo.get(manual))?.createdAt).toBe(2)
    const rows = await sql<{ n: number }>`select count(*) as n from desktop_items`.execute(db)
    expect(rows.rows[0]?.n).toBe(1)
  })

  it('updateAuto with from = [auto, exit] turns an exit back into an auto (same id)', async () => {
    const db = await memoryDb()
    const repo = new DesktopSnapshotRepo(db, 'PC-A')
    const exit = await repo.insert({ kind: 'exit', createdAt: 1, logonAt: 5, items: [] })
    expect(await repo.updateAuto(exit, { createdAt: 9, items: [] })).toBe(false)
    expect(
      await repo.updateAuto(exit, { createdAt: 9, items: [explorer('C:\\x')] }, ['auto', 'exit'])
    ).toBe(true)
    expect(await repo.get(exit)).toMatchObject({ kind: 'auto', createdAt: 9, itemCount: 1 })
  })

  it('convertToExit turns an auto of this machine into an exit in place; refuses others', async () => {
    const db = await memoryDb()
    const a = new DesktopSnapshotRepo(db, 'PC-A')
    const b = new DesktopSnapshotRepo(db, 'PC-B')
    const auto = await a.insert({
      kind: 'auto',
      createdAt: 1,
      logonAt: 5,
      items: [explorer('C:\\old1'), explorer('C:\\old2')]
    })
    const manual = await a.insert({ kind: 'manual', createdAt: 2, logonAt: 5, items: [] })
    const other = await b.insert({ kind: 'auto', createdAt: 3, logonAt: 5, items: [] })
    expect(await a.convertToExit(auto, { createdAt: 70, items: [explorer('C:\\kept')] })).toBe(true)
    const snap = await a.get(auto)
    expect(snap).toMatchObject({ kind: 'exit', createdAt: 70, logonAt: 5, itemCount: 1 })
    expect(snap?.items.map((i) => i.item)).toEqual([explorer('C:\\kept')])
    // 已是 exit、manual、别的机器的 auto：都不改
    expect(await a.convertToExit(auto, { createdAt: 80, items: [] })).toBe(false)
    expect(await a.convertToExit(manual, { createdAt: 80, items: [] })).toBe(false)
    expect(await a.convertToExit(other, { createdAt: 80, items: [] })).toBe(false)
    expect((await a.get(manual))?.kind).toBe('manual')
    expect(await b.get(other)).toMatchObject({ kind: 'auto', createdAt: 3 })
  })

  it('deleteAuto deletes only an auto of this machine', async () => {
    const db = await memoryDb()
    const a = new DesktopSnapshotRepo(db, 'PC-A')
    const b = new DesktopSnapshotRepo(db, 'PC-B')
    const auto = await a.insert({ kind: 'auto', createdAt: 1, logonAt: 5, items: [] })
    const exit = await a.insert({ kind: 'exit', createdAt: 2, logonAt: 5, items: [] })
    const other = await b.insert({ kind: 'auto', createdAt: 3, logonAt: 5, items: [] })
    expect(await a.deleteAuto(exit)).toBe(false)
    expect(await a.deleteAuto(other)).toBe(false)
    expect(await a.deleteAuto(auto)).toBe(true)
    expect((await a.listByLogon()).map((s) => s.id)).toEqual([exit])
    expect(await b.get(other)).not.toBeNull()
  })

  it('deleteAll removes every snapshot of this machine (incl. exit-none) but not others', async () => {
    const db = await memoryDb()
    const a = new DesktopSnapshotRepo(db, 'PC-A')
    const b = new DesktopSnapshotRepo(db, 'PC-B')
    await seed(a, ['auto', 'exit-none', 'manual'])
    const idB = await b.insert({
      kind: 'auto',
      createdAt: 1,
      logonAt: 1,
      items: [explorer('C:\\b')]
    })
    await a.deleteAll()
    expect(await a.listByLogon()).toEqual([])
    expect((await b.get(idB))?.itemCount).toBe(1)
  })
})
