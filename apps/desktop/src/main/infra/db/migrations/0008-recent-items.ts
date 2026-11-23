import { sql, type Kysely } from 'kysely'

// 迁移只依赖 Kysely<unknown>：迁移代码一旦发布就不再修改，不能随 schema.ts 的类型变化
// 最近使用（M5）：按工作区记录明确打开的文件 / 目录；工作区删除时级联删除
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('recent_items')
    .addColumn('id', 'integer', (c) => c.primaryKey().autoIncrement())
    .addColumn('workspace_id', 'text', (c) =>
      c.notNull().references('workspaces.id').onDelete('cascade')
    )
    .addColumn('uri', 'text', (c) => c.notNull())
    .addColumn('kind', 'text', (c) => c.notNull().check(sql`kind in ('file', 'directory')`))
    .addColumn('title', 'text', (c) => c.notNull())
    .addColumn('opened_at', 'integer', (c) => c.notNull())
    .addUniqueConstraint('recent_items_workspace_uri', ['workspace_id', 'uri'])
    .execute()
  await sql`create index recent_items_workspace_opened on recent_items (workspace_id, opened_at desc)`.execute(
    db
  )
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('recent_items').execute()
}
