import { DatabaseSync } from 'node:sqlite'
import { Kysely, sql, SqliteDialect, type SqliteDatabase } from 'kysely'
import { Migrator } from 'kysely/migration'
import { afterEach, describe, expect, it } from 'vitest'
import { migrations } from '.'

describe('migration 0004-cache-strategy', () => {
  let db: Kysely<unknown>
  afterEach(async () => {
    await db.destroy()
  })

  function open(): Migrator {
    const sqlite = new DatabaseSync(':memory:')
    sqlite.exec('PRAGMA foreign_keys = ON;')
    const adapted: SqliteDatabase = {
      close: () => sqlite.close(),
      prepare(text) {
        const stmt = sqlite.prepare(text)
        return {
          reader: stmt.columns().length > 0,
          all: (p) => stmt.all(...(p as never[])),
          run: (p) => stmt.run(...(p as never[])),
          iterate: (p) => stmt.iterate(...(p as never[]))
        }
      }
    }
    db = new Kysely<unknown>({ dialect: new SqliteDialect({ database: adapted }) })
    return new Migrator({ db, provider: { getMigrations: async () => migrations } })
  }

  const insert = (id: string, level: string | null): Promise<unknown> =>
    sql`insert into workspace_entries (id, workspace_id, kind, label, uri, sort_order, refresh_level, created_at, updated_at)
        values (${id}, 'default', 'folder', ${id}, ${`file:///C:/${id}`}, 0, ${level}, 1, 1)`.execute(
      db
    )

  it('renames refresh_level to cache_strategy and keeps the old values', async () => {
    const migrator = open()
    expect((await migrator.migrateTo('0003-refresh')).error).toBeUndefined()
    await insert('a', 'passive')
    await insert('b', 'all')
    await insert('c', null)

    expect((await migrator.migrateToLatest()).error).toBeUndefined()

    const rows = await sql<{ id: string; cache_strategy: string | null }>`
      select id, cache_strategy from workspace_entries order by id`.execute(db)
    expect(rows.rows).toEqual([
      { id: 'a', cache_strategy: 'passive' },
      { id: 'b', cache_strategy: 'all' },
      { id: 'c', cache_strategy: null }
    ])
    const cols = await sql<{ name: string }>`pragma table_info(workspace_entries)`.execute(db)
    expect(cols.rows.map((c) => c.name)).not.toContain('refresh_level')
  })

  it('still rejects an unknown value after the rename (CHECK constraint kept)', async () => {
    const migrator = open()
    expect((await migrator.migrateToLatest()).error).toBeUndefined()
    await expect(
      sql`insert into workspace_entries (id, workspace_id, kind, label, uri, sort_order, cache_strategy, created_at, updated_at)
          values ('x', 'default', 'folder', 'x', 'file:///C:/x', 0, 'bogus', 1, 1)`.execute(db)
    ).rejects.toThrow()
    await sql`insert into workspace_entries (id, workspace_id, kind, label, uri, sort_order, cache_strategy, created_at, updated_at)
              values ('y', 'default', 'folder', 'y', 'file:///C:/y', 0, 'active', 1, 1)`.execute(db)
    await expect(
      sql`update workspace_entries set cache_strategy = 'bogus' where id = 'y'`.execute(db)
    ).rejects.toThrow()
  })
})
