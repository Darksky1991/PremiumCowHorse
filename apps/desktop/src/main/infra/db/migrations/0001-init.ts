import type { Kysely } from 'kysely'

// 迁移只依赖 Kysely<unknown>：迁移代码一旦发布就不再修改，不能随 schema.ts 的类型变化
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('settings')
    .addColumn('key', 'text', (c) => c.primaryKey())
    .addColumn('value', 'text', (c) => c.notNull())
    .addColumn('updated_at', 'integer', (c) => c.notNull())
    .execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('settings').execute()
}
