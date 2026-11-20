import type { Kysely } from 'kysely'

// 迁移只依赖 Kysely<unknown>：迁移代码一旦发布就不再修改，不能随 schema.ts 的类型变化
// 「刷新级别」改名为「缓存策略」：列改名，旧值与 CHECK 约束保留（SQLite RENAME COLUMN 会同步改写约束中的列名）
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('workspace_entries')
    .renameColumn('refresh_level', 'cache_strategy')
    .execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('workspace_entries')
    .renameColumn('cache_strategy', 'refresh_level')
    .execute()
}
