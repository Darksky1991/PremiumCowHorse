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

/** 一个窗口（owner）告诉调度器的关注点与可见目录（整体替换） */
export interface Interest {
  focus: string | null
  /** 视口内的已展开目录 */
  visible: string[]
  /** 已展开但滚出视口的目录 */
  offscreen: string[]
}

/** 共享（`\\host\share`，小写）或卷（`C:`）的可达状态变化；since 为进入该状态的时刻（Unix 毫秒） */
export interface ReachabilityEvent {
  share: string
  state: 'online' | 'offline'
  since: number
}

/** 当前断开的共享 / 卷与断开时刻（vfs.offlineShares：渲染端启动 / 重新加载时初始化断开状态） */
export interface OfflineShare {
  share: string
  since: number
}
