/**
 * 数据库表的 TypeScript 类型（Kysely 查询的类型来源）。
 * 表结构的唯一事实来源是 migrations/：新增或修改表时，先写迁移，再同步这里的类型。
 */

/** 只保存与默认值不同的设置项；value 为 JSON 字符串 */
export interface SettingsTable {
  key: string
  value: string
  updated_at: number
}

export interface DB {
  settings: SettingsTable
}
