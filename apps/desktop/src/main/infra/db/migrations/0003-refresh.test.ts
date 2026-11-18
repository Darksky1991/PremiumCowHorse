import { DatabaseSync } from 'node:sqlite'
import { Kysely, sql, SqliteDialect, type SqliteDatabase } from 'kysely'
import { Migrator } from 'kysely/migration'
import { afterEach, describe, expect, it } from 'vitest'
import { migrations } from '.'

describe('migration 0003-refresh', () => {
  let db: Kysely<unknown>
  afterEach(async () => {
    await db.destroy()
  })

  it('keeps old rows (refresh_level NULL) and normalizes trailing slashes of entry URIs', async () => {
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
    const migrator = new Migrator({ db, provider: { getMigrations: async () => migrations } })

    expect((await migrator.migrateTo('0002-workspaces')).error).toBeUndefined()
    const row = (id: string, uri: string | null, kind = 'folder'): Promise<unknown> =>
      sql`insert into workspace_entries (id, workspace_id, kind, label, uri, sort_order, created_at, updated_at)
          values (${id}, 'default', ${kind}, ${id}, ${uri}, 0, 1, 1)`.execute(db)
    await row('a', 'file:///C:/a/')
    await row('b', 'file:///C:/b//')
    await row('c', 'file:///C:/')
    await row('d', 'file://srv/share/')
    await row('e', 'file:///C:/e')
    await row('g', null, 'group')

    expect((await migrator.migrateToLatest()).error).toBeUndefined()

    const rows = await sql<{ id: string; uri: string | null; refresh_level: string | null }>`
      select id, uri, refresh_level from workspace_entries order by id`.execute(db)
    expect(rows.rows).toEqual([
      { id: 'a', uri: 'file:///C:/a', refresh_level: null },
      { id: 'b', uri: 'file:///C:/b', refresh_level: null },
      { id: 'c', uri: 'file:///C:/', refresh_level: null },
      { id: 'd', uri: 'file://srv/share', refresh_level: null },
      { id: 'e', uri: 'file:///C:/e', refresh_level: null },
      { id: 'g', uri: null, refresh_level: null }
    ])
  })
})
