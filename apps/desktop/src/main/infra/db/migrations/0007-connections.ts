import type { Kysely } from 'kysely'

// 迁移只依赖 Kysely<unknown>：迁移代码一旦发布就不再修改，不能随 schema.ts 的类型变化
// 远程连接（M4）。secret / sudo_secret 为加密后的 base64；identities / host_key / options 为 JSON 文本
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('connections')
    .addColumn('id', 'text', (c) => c.primaryKey())
    .addColumn('name', 'text', (c) => c.notNull())
    .addColumn('host', 'text', (c) => c.notNull())
    .addColumn('port', 'integer', (c) => c.notNull())
    .addColumn('username', 'text', (c) => c.notNull())
    .addColumn('auth', 'text', (c) => c.notNull())
    .addColumn('key_path', 'text')
    .addColumn('secret', 'text')
    .addColumn('sudo_secret', 'text')
    .addColumn('identities', 'text', (c) => c.notNull())
    .addColumn('host_key', 'text')
    .addColumn('options', 'text', (c) => c.notNull())
    .addColumn('auth_state', 'text', (c) => c.notNull().defaultTo('ok'))
    .addColumn('created_at', 'integer', (c) => c.notNull())
    .addColumn('updated_at', 'integer', (c) => c.notNull())
    .execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('connections').execute()
}
