/**
 * 数据库表的 TypeScript 类型（Kysely 查询的类型来源）。
 * 表结构的唯一事实来源是 migrations/：新增或修改表时，先写迁移，再同步这里的类型。
 */
import type { Generated } from 'kysely'

/** 只保存与默认值不同的设置项；value 为 JSON 字符串 */
export interface SettingsTable {
  key: string
  value: string
  updated_at: number
}

/** boolean 列以 0 / 1 存储；时间戳为 UNIX 毫秒 */
export interface WorkspacesTable {
  id: string
  name: string
  description: string | null
  color: string | null
  sort_order: number
  archived: number
  last_opened_at: number | null
  created_at: number
  updated_at: number
}

/** meta 为 JSON 字符串 */
export interface WorkspaceEntriesTable {
  id: string
  workspace_id: string
  parent_id: string | null
  kind: 'group' | 'folder' | 'file'
  label: string
  uri: string | null
  sort_order: number
  meta: string | null
  cache_strategy: 'passive' | 'default' | 'active' | 'all' | null
  created_at: number
  updated_at: number
}

/** 「建立索引」的目标目录（file URI，已规范化）；只属于一个工作区，随工作区删除 */
export interface IndexTargetsTable {
  workspace_id: string
  uri: string
  created_at: number
}

/**
 * 打开方式检测结果（主键 (machine, ext)）；machine 为检测所在机器的主机名，
 * data 为 LaunchCapabilities 的 JSON，detected_at 为 UNIX 毫秒
 */
export interface LaunchCapabilitiesTable {
  machine: string
  ext: string
  data: string
  detected_at: number
}

/**
 * 桌面记录快照（M3）。machine 为主机名（只读写本机的行）；kind 为 DesktopSnapshotKind；
 * created_at / logon_at 为 UNIX 毫秒（logon_at 为该次登录的开始时刻）
 */
export interface DesktopSnapshotsTable {
  id: Generated<number>
  machine: string
  kind: string
  created_at: number
  logon_at: number
  name: string | null
}

/** 快照中的项目。data 为 DesktopItem 的 JSON，sort 为快照内的顺序 */
export interface DesktopItemsTable {
  id: Generated<number>
  snapshot_id: number
  sort: number
  data: string
}

/**
 * 远程连接（M4）。secret / sudo_secret 为加密后的 base64；identities 为 string[] 的 JSON；
 * host_key 为 HostKeyInfo 的 JSON；options 为 { sftpServerPath: string | null } 的 JSON；
 * auth_state 为 ConnectionAuthState
 */
export interface ConnectionsTable {
  id: string
  name: string
  host: string
  port: number
  username: string
  auth: string
  key_path: string | null
  secret: string | null
  sudo_secret: string | null
  identities: string
  host_key: string | null
  options: string
  auth_state: string
  created_at: number
  updated_at: number
}

export interface DB {
  settings: SettingsTable
  workspaces: WorkspacesTable
  workspace_entries: WorkspaceEntriesTable
  index_targets: IndexTargetsTable
  launch_capabilities: LaunchCapabilitiesTable
  desktop_snapshots: DesktopSnapshotsTable
  desktop_items: DesktopItemsTable
  connections: ConnectionsTable
}
