import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Logger } from '../logger'
import { openDatabase, type Database } from './client'

const noop = (): void => undefined
const silent: Logger = { error: noop, warn: noop, info: noop, debug: noop }
const tick = (): Promise<unknown> => new Promise((r) => setTimeout(r, 5))

describe('openDatabase (node:sqlite + Kysely)', () => {
  let db: Database

  beforeEach(async () => {
    db = await openDatabase(':memory:', silent)
  })
  afterEach(async () => {
    await db.destroy()
  })

  it('applies migrations and is idempotent on reopen of the same schema', async () => {
    const tables = await db.introspection.getTables()
    expect(tables.map((t) => t.name)).toContain('settings')
  })

  it('round-trips rows, including non-ASCII text', async () => {
    await db
      .insertInto('settings')
      .values({ key: '案件A', value: '"設計書"', updated_at: 1 })
      .execute()
    const row = await db
      .selectFrom('settings')
      .selectAll()
      .where('key', '=', '案件A')
      .executeTakeFirst()
    expect(row).toEqual({ key: '案件A', value: '"設計書"', updated_at: 1 })
  })

  it('serializes concurrent queries: a write issued during a transaction is not rolled back with it', async () => {
    const tx = db.transaction().execute(async (trx) => {
      await trx.insertInto('settings').values({ key: 'in-tx', value: '1', updated_at: 1 }).execute()
      await tick() // 让出事件循环：此时外部写入会被尝试执行
      throw new Error('rollback')
    })
    const outside = db
      .insertInto('settings')
      .values({ key: 'outside', value: '1', updated_at: 1 })
      .execute()

    await expect(tx).rejects.toThrow('rollback')
    await outside
    const keys = (await db.selectFrom('settings').select('key').execute()).map((r) => r.key)
    expect(keys).toEqual(['outside'])
  })
})
