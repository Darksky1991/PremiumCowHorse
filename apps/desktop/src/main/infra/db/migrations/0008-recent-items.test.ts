import { DatabaseSync } from 'node:sqlite'
import { Kysely, sql, SqliteDialect, type SqliteDatabase } from 'kysely'
import { Migrator } from 'kysely/migration'
import { afterEach, describe, expect, it } from 'vitest'
import { migrations } from '.'

describe('migration 0008-recent-items', () => {
  let db: Kysely<unknown>
  afterEach(async () => {
    await db.destroy()
  })

  async function open(): Promise<void> {
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
    expect((await migrator.migrateToLatest()).error).toBeUndefined()
    await sql`insert into workspaces (id, name, sort_order, archived, created_at, updated_at)
              values ('w1', 'w1', 1, 0, 1, 1)`.execute(db)
  }

  const insert = (uri: string, kind = 'file'): Promise<unknown> =>
    sql`insert into recent_items (workspace_id, uri, kind, title, opened_at)
        values ('w1', ${uri}, ${kind}, 't', 1)`.execute(db)

  it('rejects a second row with the same (workspace_id, uri)', async () => {
    await open()
    await insert('file:///a')
    await expect(insert('file:///a')).rejects.toThrow()
    await insert('file:///b')
  })

  it('rejects an unknown kind', async () => {
    await open()
    await expect(insert('file:///a', 'link')).rejects.toThrow()
  })

  it('cascades when the workspace row is deleted', async () => {
    await open()
    await insert('file:///a')
    await insert('file:///b')
    await sql`delete from workspaces where id = 'w1'`.execute(db)
    const rows = await sql<{ n: number }>`select count(*) as n from recent_items`.execute(db)
    expect(Number(rows.rows[0]!.n)).toBe(0)
  })
})
