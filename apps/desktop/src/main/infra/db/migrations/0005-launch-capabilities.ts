import type { Kysely } from 'kysely'

// 迁移只依赖 Kysely<unknown>：迁移代码一旦发布就不再修改，不能随 schema.ts 的类型变化
// Office 等文件的打开方式检测结果，按 (机器, 扩展名) 各保存一份。
// 用户数据目录在 %APPDATA%（Roaming）下，漫游配置文件 / 文件夹重定向时同一个数据库会跟着用户到别的机器，
// 因此以机器标识（主机名）区分：只读本机的行，再検出只清本机的行
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('launch_capabilities')
    .addColumn('machine', 'text', (c) => c.notNull())
    .addColumn('ext', 'text', (c) => c.notNull())
    .addColumn('data', 'text', (c) => c.notNull())
    .addColumn('detected_at', 'integer', (c) => c.notNull())
    .addPrimaryKeyConstraint('pk_launch_capabilities', ['machine', 'ext'])
    .execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('launch_capabilities').execute()
}
