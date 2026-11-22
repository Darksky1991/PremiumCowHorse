import { DatabaseSync } from 'node:sqlite'
import { Kysely, sql, SqliteDialect, type SqliteDatabase } from 'kysely'
import { Migrator } from 'kysely/migration'
import { afterEach, describe, expect, it } from 'vitest'
import { migrations } from '.'

describe('migration 0006-desktop-snapshots', () => {
  let db: Kysely<unknown>
  afterEach(async () => {
    await db.destroy()
  })

  it('creates both tables, cascades item deletion and drops them on down', async () => {
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

    expect((await migrator.migrateTo('0005-launch-capabilities')).error).toBeUndefined()
    expect((await migrator.migrateTo('0006-desktop-snapshots')).error).toBeUndefined()

    await sql`insert into desktop_snapshots (machine, kind, created_at, logon_at) values ('PC-A', 'auto', 1, 1)`.execute(
      db
    )
    await sql`insert into desktop_items (snapshot_id, sort, data) values (1, 0, '{}'), (1, 1, '{}')`.execute(
      db
    )
    await sql`delete from desktop_snapshots where id = 1`.execute(db)
    const rest = await sql<{ n: number }>`select count(*) as n from desktop_items`.execute(db)
    expect(rest.rows[0]?.n).toBe(0)

    expect((await migrator.migrateTo('0005-launch-capabilities')).error).toBeUndefined()
    await expect(sql`select * from desktop_snapshots`.execute(db)).rejects.toThrow()
    await expect(sql`select * from desktop_items`.execute(db)).rejects.toThrow()
  })
})
