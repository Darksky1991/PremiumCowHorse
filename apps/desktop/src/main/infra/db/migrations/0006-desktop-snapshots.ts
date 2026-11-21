import { sql, type Kysely } from 'kysely'

// 迁移只依赖 Kysely<unknown>：迁移代码一旦发布就不再修改，不能随 schema.ts 的类型变化
// 桌面记录（M3）的快照与项目。
// 与 launch_capabilities 同理，数据库可能随漫游配置到别的机器，因此快照以 machine（主机名）区分，只读写本机的行
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('desktop_snapshots')
    .addColumn('id', 'integer', (c) => c.primaryKey().autoIncrement())
    .addColumn('machine', 'text', (c) => c.notNull())
    .addColumn('kind', 'text', (c) => c.notNull())
    .addColumn('created_at', 'integer', (c) => c.notNull())
    .addColumn('logon_at', 'integer', (c) => c.notNull())
    .addColumn('name', 'text')
    .execute()
  await db.schema
    .createIndex('idx_desktop_snapshots_machine_created')
    .on('desktop_snapshots')
    .columns(['machine', 'created_at'])
    .execute()

  await db.schema
    .createTable('desktop_items')
    .addColumn('id', 'integer', (c) => c.primaryKey().autoIncrement())
    .addColumn('snapshot_id', 'integer', (c) =>
      c.notNull().references('desktop_snapshots.id').onDelete('cascade')
    )
    .addColumn('sort', 'integer', (c) => c.notNull())
    .addColumn('data', 'text', (c) => c.notNull())
    .execute()
  await sql`create index idx_desktop_items_snapshot on desktop_items (snapshot_id)`.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('desktop_items').execute()
  await db.schema.dropTable('desktop_snapshots').execute()
}
