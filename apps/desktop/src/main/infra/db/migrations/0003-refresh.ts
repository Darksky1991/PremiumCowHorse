import { sql, type Kysely } from 'kysely'

// 迁移只依赖 Kysely<unknown>：迁移代码一旦发布就不再修改，不能随 schema.ts 的类型变化
export async function up(db: Kysely<unknown>): Promise<void> {
  // 条目级刷新级别：NULL = 沿用全局默认
  await sql`alter table workspace_entries add column refresh_level text null
            check (refresh_level in ('passive', 'default', 'active', 'all'))`.execute(db)

  await db.schema
    .createTable('index_targets')
    .addColumn('workspace_id', 'text', (c) =>
      c.notNull().references('workspaces.id').onDelete('cascade')
    )
    .addColumn('uri', 'text', (c) => c.notNull())
    .addColumn('created_at', 'integer', (c) => c.notNull())
    .addPrimaryKeyConstraint('pk_index_targets', ['workspace_id', 'uri'])
    .execute()

  // 条目 URI 规范化：去掉结尾 `/`（驱动器根 `file:///C:/` 保留），使其与扫描进程的根 URI 一致
  const rows = await sql<{ id: string; uri: string }>`
    select id, uri from workspace_entries where uri is not null and uri like '%/'`.execute(db)
  for (const row of rows.rows) {
    const trimmed = row.uri.replace(/\/+$/, '')
    const next = /^file:\/\/\/[A-Za-z]:$/.test(trimmed) ? `${trimmed}/` : trimmed
    if (next !== row.uri) {
      await sql`update workspace_entries set uri = ${next} where id = ${row.id}`.execute(db)
    }
  }
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('index_targets').execute()
  await sql`alter table workspace_entries drop column refresh_level`.execute(db)
}
