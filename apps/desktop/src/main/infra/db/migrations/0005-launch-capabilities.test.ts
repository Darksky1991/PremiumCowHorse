import { DatabaseSync } from 'node:sqlite'
import { Kysely, sql, SqliteDialect, type SqliteDatabase } from 'kysely'
import { Migrator } from 'kysely/migration'
import { afterEach, describe, expect, it } from 'vitest'
import { migrations } from '.'

describe('migration 0005-launch-capabilities', () => {
  let db: Kysely<unknown>
  afterEach(async () => {
    await db.destroy()
  })

  it('creates the table keyed by (machine, ext) and drops it on down', async () => {
    const sqlite = new DatabaseSync(':memory:')
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

    expect((await migrator.migrateTo('0004-cache-strategy')).error).toBeUndefined()
    expect((await migrator.migrateTo('0005-launch-capabilities')).error).toBeUndefined()
    const insert = async (machine: string, ext: string): Promise<void> => {
      await sql`insert into launch_capabilities (machine, ext, data, detected_at) values (${machine}, ${ext}, '{}', 1)`.execute(
        db
      )
    }
    await insert('PC-A', 'xlsx')
    // 同一扩展名在不同机器上各一行；同一机器同一扩展名只有一行
    await insert('PC-B', 'xlsx')
    await insert('PC-A', 'docx')
    await expect(insert('PC-A', 'xlsx')).rejects.toThrow()

    expect((await migrator.migrateTo('0004-cache-strategy')).error).toBeUndefined()
    await expect(sql`select * from launch_capabilities`.execute(db)).rejects.toThrow()
  })
})
