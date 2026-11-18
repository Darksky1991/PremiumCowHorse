/** 刷新级别：消极 / 默认 / 积极 / 全部（设计 4.5） */
export type RefreshLevel = 'passive' | 'default' | 'active' | 'all'

/** 一个参与扫描的 folder 根条目（扫描进程与主进程共用） */
export interface RootConfig {
  entryId: string
  workspaceId: string
  uri: string
  level: RefreshLevel
  location: 'local' | 'network'
}

/** 调度器使用的设置（由设置 refresh.* / vfs.timeoutSec.* 换算，设计 4.9） */
export interface ScanSettings {
  intervalSec: { local: number; network: number }
  backgroundIntervalMin: number
  timeoutSec: { local: number; network: number }
  activeDepth: number
}
