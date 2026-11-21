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
    await a.prune(0, 0)
    expect((await b.get(idB))?.name).toBeNull()
  })

  it('round-trips items in order with itemCount, name and kind', async () => {
    const db = await memoryDb()
    const repo = new DesktopSnapshotRepo(db, 'PC-A')
    const items = [
      explorer('C:\\a'),
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
      itemCount: 3
    })
    expect(snap?.items.map((i) => i.item)).toEqual(items)
    const list = await repo.list()
    expect(list.map((s) => [s.createdAt, s.itemCount])).toEqual([
      [6, 0],
      [5, 3]
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

  it('prune(20, 10) keeps recent autos, last auto of recent logons, manual and exit', async () => {
    const db = await memoryDb()
    const repo = new DesktopSnapshotRepo(db, 'PC-A')
    // 25 份 auto 分属 12 次登录：前 10 份各自一次登录，之后 7 份属第 11 次、最后 8 份属第 12 次
    const autoIds: number[] = []
    for (let i = 0; i < 25; i++) {
      const logon = i < 10 ? i : i < 17 ? 10 : 11
      autoIds.push(
        await repo.insert({
          kind: 'auto',
          createdAt: 1000 + i,
          logonAt: 100 + logon,
          items: [explorer(`C:\\${i}`)]
        })
      )
    }
    const manual = await repo.insert({ kind: 'manual', createdAt: 1, logonAt: 100, items: [] })
    const exit = await repo.insert({ kind: 'exit', createdAt: 2, logonAt: 100, items: [] })

    await repo.prune(20, 10)

    const left = (await repo.listByLogon()).map((s) => s.id).sort(byNumber)
    // 最近 20 份：i = 5..24；最近 10 次登录（第 2..11 次）的最后一份：i = 2..9、16、24 → 并集 i = 2..24
    const expected = [...autoIds.slice(2), manual, exit].sort(byNumber)
    expect(left).toEqual(expected)
    // 项目随快照级联删除
    const items = await sql<{ n: number }>`select count(*) as n from desktop_items`.execute(db)
    expect(items.rows[0]?.n).toBe(23)
  })

  it('prune keeps exit-none only within the most recent logons', async () => {
    const db = await memoryDb()
    const repo = new DesktopSnapshotRepo(db, 'PC-A')
    const ids: number[] = []
    for (let k = 0; k < 4; k++) {
      ids.push(
        await repo.insert({ kind: 'exit-none', createdAt: 10 + k, logonAt: 100 + k, items: [] })
      )
    }
    await repo.prune(20, 2)
    expect((await repo.listByLogon()).map((s) => s.id).sort(byNumber)).toEqual([ids[2], ids[3]])
  })

  it('prune counts auto logons separately from manual / exit-none logons', async () => {
    const db = await memoryDb()
    const repo = new DesktopSnapshotRepo(db, 'PC-A')
    // 登录 0、1 只有 auto；较新的登录 2、3 只有 manual / exit-none
    const old0 = await repo.insert({ kind: 'auto', createdAt: 1, logonAt: 100, items: [] })
    const old1 = await repo.insert({ kind: 'auto', createdAt: 2, logonAt: 101, items: [] })
    const manual = await repo.insert({ kind: 'manual', createdAt: 3, logonAt: 102, items: [] })
    const none = await repo.insert({ kind: 'exit-none', createdAt: 4, logonAt: 103, items: [] })

    await repo.prune(0, 2)

    // auto 只数有 auto 的登录（100、101），各自最后一份保留；exit-none 在最近 2 个登录内
    expect((await repo.listByLogon()).map((s) => s.id).sort(byNumber)).toEqual(
      [old0, old1, manual, none].sort(byNumber)
    )
  })
})
