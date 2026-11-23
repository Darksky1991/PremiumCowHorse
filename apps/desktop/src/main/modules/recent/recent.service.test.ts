import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { sql } from 'kysely'
import { DEFAULT_WORKSPACE_ID } from '@pch/shared'
import { EventBus } from '../../core/event-bus'
import type { MainEvents } from '../../core/events'
import { openDatabase, type Database } from '../../infra/db/client'
import type { Logger } from '../../infra/logger'
import { RecentRepo } from './recent.repo'
import { RecentService } from './recent.service'

const noop = (): void => undefined
const silent: Logger = { error: noop, warn: noop, info: noop, debug: noop }
const W1 = DEFAULT_WORKSPACE_ID
const W2 = 'w2'

describe('RecentService', () => {
  let db: Database
  let service: RecentService
  let events: MainEvents['recent.changed'][]
  let clock: number

  beforeEach(async () => {
    db = await openDatabase(':memory:', silent)
    await sql`insert into workspaces (id, name, sort_order, archived, created_at, updated_at)
              values (${W2}, 'w2', 9, 0, 1, 1)`.execute(db)
    const bus = new EventBus<MainEvents>()
    events = []
    bus.on('recent.changed', (e) => events.push(e))
    clock = 1000
    service = new RecentService(new RecentRepo(db), bus, () => ++clock)
  })
  afterEach(async () => {
    await db.destroy()
  })

  const rec = (uri: string, ws = W1): Promise<void> =>
    service.record({ workspaceId: ws, uri, kind: 'file', title: uri })

  it('lists newest first and honours the limit', async () => {
    await rec('a')
    await rec('b')
    await rec('c')
    expect((await service.list(W1, 10)).map((i) => i.uri)).toEqual(['c', 'b', 'a'])
    expect((await service.list(W1, 2)).map((i) => i.uri)).toEqual(['c', 'b'])
    expect(await service.list(W2, 10)).toEqual([])
  })

  it('recording the same uri again only updates opened_at', async () => {
    await rec('a')
    await rec('b')
    await service.record({ workspaceId: W1, uri: 'a', kind: 'file', title: 'A2' })
    const items = await service.list(W1, 10)
    expect(items.map((i) => i.uri)).toEqual(['a', 'b'])
    expect(items[0]).toMatchObject({ title: 'A2', openedAt: 1003 })
    const count = await sql<{
      n: number
    }>`select count(*) as n from recent_items where workspace_id = ${W1}`.execute(db)
    expect(Number(count.rows[0]!.n)).toBe(2)
  })

  it('keeps only the newest 100 per workspace', async () => {
    for (let i = 0; i < 101; i++) await rec(`u${i}`)
    await rec('other', W2)
    const items = await service.list(W1, 100)
    expect(items).toHaveLength(100)
    expect(items[0]!.uri).toBe('u100')
    expect(items.map((i) => i.uri)).not.toContain('u0')
    expect(items.at(-1)!.uri).toBe('u1')
    expect(await service.list(W2, 100)).toHaveLength(1)
    const count = await sql<{
      n: number
    }>`select count(*) as n from recent_items where workspace_id = ${W1}`.execute(db)
    expect(Number(count.rows[0]!.n)).toBe(100)
  })

  it('clear() removes everything, clear({ workspaceId }) only that workspace', async () => {
    await rec('a')
    await rec('b', W2)
    await service.clear({ workspaceId: W1 })
    expect(await service.list(W1, 10)).toEqual([])
    expect(await service.list(W2, 10)).toHaveLength(1)
    await service.clear()
    expect(await service.list(W2, 10)).toEqual([])
  })

  it('emits one recent.changed per write', async () => {
    await rec('a')
    await rec('a')
    expect(events).toEqual([{ workspaceId: W1 }, { workspaceId: W1 }])
    await service.clear({ workspaceId: W2 })
    await service.clear()
    expect(events.slice(2)).toEqual([{ workspaceId: W2 }, { workspaceId: null }])
  })
})
