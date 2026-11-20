import { sql, type Kysely } from 'kysely'

// 迁移只依赖 Kysely<unknown>：迁移代码一旦发布就不再修改，不能随 schema.ts 的类型变化
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('workspaces')
    .addColumn('id', 'text', (c) => c.primaryKey())
    .addColumn('name', 'text', (c) => c.notNull())
    .addColumn('description', 'text')
    .addColumn('color', 'text')
    .addColumn('sort_order', 'integer', (c) => c.notNull().defaultTo(0))
    .addColumn('archived', 'integer', (c) => c.notNull().defaultTo(0))
    .addColumn('last_opened_at', 'integer')
    .addColumn('created_at', 'integer', (c) => c.notNull())
    .addColumn('updated_at', 'integer', (c) => c.notNull())
    .execute()

  await db.schema
    .createTable('workspace_entries')
    .addColumn('id', 'text', (c) => c.primaryKey())
    .addColumn('workspace_id', 'text', (c) =>
      c.notNull().references('workspaces.id').onDelete('cascade')
    )
    // NULL 为根；只能指向同一工作区的 group（由 WorkspaceService 保证）
    .addColumn('parent_id', 'text')
    .addColumn('kind', 'text', (c) => c.notNull().check(sql`kind in ('group', 'folder', 'file')`))
    .addColumn('label', 'text', (c) => c.notNull())
    .addColumn('uri', 'text')
    .addColumn('sort_order', 'integer', (c) => c.notNull().defaultTo(0))
    .addColumn('meta', 'text')
    .addColumn('created_at', 'integer', (c) => c.notNull())
    .addColumn('updated_at', 'integer', (c) => c.notNull())
    .execute()

  await db.schema
    .createIndex('idx_entries_ws_parent')
    .on('workspace_entries')
    .columns(['workspace_id', 'parent_id'])
    .execute()

  // 默认工作区：name 为空字符串时界面显示本地化的默认名称
  const now = Date.now()
  await sql`insert into workspaces (id, name, sort_order, archived, created_at, updated_at)
            values ('default', '', 0, 0, ${now}, ${now})`.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('workspace_entries').execute()
  await db.schema.dropTable('workspaces').execute()
}
