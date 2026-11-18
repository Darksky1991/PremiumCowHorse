import type { Database } from '../../infra/db/client'

/** 只做数据存取，不含业务规则。值以 JSON 字符串存储。 */
export class SettingsRepo {
  constructor(private readonly db: Database) {}

  async getAll(): Promise<Record<string, unknown>> {
    const rows = await this.db.selectFrom('settings').select(['key', 'value']).execute()
    return Object.fromEntries(rows.map((r) => [r.key, JSON.parse(r.value) as unknown]))
  }

  async upsert(key: string, value: unknown): Promise<void> {
    const row = { key, value: JSON.stringify(value), updated_at: Date.now() }
    await this.db
      .insertInto('settings')
      .values(row)
      .onConflict((oc) =>
        oc.column('key').doUpdateSet({ value: row.value, updated_at: row.updated_at })
      )
      .execute()
  }

  async delete(key: string): Promise<void> {
    await this.db.deleteFrom('settings').where('key', '=', key).execute()
  }
}
