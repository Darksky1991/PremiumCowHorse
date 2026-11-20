/** 缓存策略（设计 8）：消极 / 默认 / 积极 / 全部 */
export const CACHE_STRATEGIES = ['passive', 'default', 'active', 'all'] as const
export type CacheStrategy = (typeof CACHE_STRATEGIES)[number]

/** 一个参与扫描的 folder 根条目（扫描进程与主进程共用） */
export interface RootConfig {
  entryId: string
  workspaceId: string
  uri: string
  strategy: CacheStrategy
  location: 'local' | 'network'
}

/** 按位置类型区分的一对取值 */
export interface LocationPair {
  local: number
  network: number
}

/** 调度器使用的设置（由设置 cache.* / vfs.timeoutSec.* 换算，设计 8.2 / 4.9） */
export interface ScanSettings {
  /** 定期确认的间隔（秒）：关注点 / 近 / 远 */
  interval: { focus: LocationPair; near: LocationPair; far: LocationPair }
  /** 后台队列每确认完一个目录后的休息时间（毫秒）；用户正在操作时加倍 */
  backgroundGapMs: LocationPair
  timeoutSec: LocationPair
  activeDepth: number
}

/** 一个窗口（owner）告诉调度器的关注点与可见目录（整体替换） */
export interface Interest {
  focus: string | null
  /** 视口内的已展开目录 */
  visible: string[]
  /** 已展开但滚出视口的目录 */
  offscreen: string[]
  /** 标签中显示的目录（激活标签显示的目录；按关注点处理：每次完整读取、关注点间隔） */
  tabs: string[]
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
