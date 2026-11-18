import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { Kysely, SqliteDialect, type SqliteDatabase } from 'kysely'
import { Migrator } from 'kysely/migration'
import type { Logger } from '../logger'
import { migrations } from './migrations'
import type { DB } from './schema'

export type Database = Kysely<DB>

/**
 * node:sqlite（Electron 内置 Node 自带，无需原生模块编译）+ Kysely（类型安全的查询构建器）。
 *
 * 并发安全：SQLite 适配器声明 supportsMultipleConnections = false，Kysely 的 RuntimeDriver
 * 会用连接互斥锁串行化所有查询，事务期间其他查询排队等待，不会混入事务。
 * 数据访问全部收敛在本文件与各模块的 *.repo.ts：将来更换驱动只改这里。
 */
export async function openDatabase(file: string, logger: Logger): Promise<Database> {
  if (file !== ':memory:') mkdirSync(path.dirname(file), { recursive: true })
  const sqlite = new DatabaseSync(file)
  sqlite.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;')

  const db = new Kysely<DB>({ dialect: new SqliteDialect({ database: adapt(sqlite) }) })

  const { error, results } = await new Migrator({
    db,
    provider: { getMigrations: async () => migrations }
  }).migrateToLatest()
  for (const r of results ?? []) logger.info(`[db] migration ${r.migrationName}: ${r.status}`)
  if (error) {
    await db.destroy()
    throw error
  }

  logger.info(`[db] opened ${file}`)
  return db
}

/**
 * Kysely 的 SqliteDialect 按 better-sqlite3 的接口设计，node:sqlite 的差异只有两点：
 * 参数以展开形式传入；没有 reader 属性（用 columns() 判断语句是否返回行）。
 */
function adapt(sqlite: DatabaseSync): SqliteDatabase {
  return {
    close: () => sqlite.close(),
    prepare(sql) {
      const stmt = sqlite.prepare(sql)
      const args = (p: ReadonlyArray<unknown>): never[] => p as never[]
      return {
        reader: stmt.columns().length > 0,
        all: (p) => stmt.all(...args(p)),
        run: (p) => stmt.run(...args(p)),
        iterate: (p) => stmt.iterate(...args(p))
      }
    }
  }
}
