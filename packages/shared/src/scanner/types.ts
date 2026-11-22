/** 缓存策略（设计 8）：消极 / 默认 / 积极 / 全部 */
export const CACHE_STRATEGIES = ['passive', 'default', 'active', 'all'] as const
export type CacheStrategy = (typeof CACHE_STRATEGIES)[number]

/** 一个参与扫描的 folder 根条目（扫描进程与主进程共用） */
export interface RootConfig {
  entryId: string
  workspaceId: string
  uri: string
  strategy: CacheStrategy
  location: LocationKind
}

/** 位置类型：本地 / 网络共享 / 远程（SFTP） */
export type LocationKind = 'local' | 'network' | 'remote'

/** 按位置类型区分的三个取值 */
export interface LocationTriple {
  local: number
  network: number
  remote: number
}

/** 按位置类型区分的一对取值（远程没有定期确认，故定期确认间隔只有 local / network） */
export interface LocationPair {
  local: number
  network: number
}

/** 调度器使用的设置（由设置 cache.* / vfs.timeoutSec.* 换算，设计 8.2 / 4.9） */
export interface ScanSettings {
  /** 定期确认的间隔（秒）：关注点 / 近 / 远 */
  interval: { focus: LocationPair; near: LocationPair; far: LocationPair }
  /** 后台队列每确认完一个目录后的休息时间（毫秒）；用户正在操作时加倍 */
  backgroundGapMs: LocationTriple
  timeoutSec: LocationTriple
  /** 远程目录的建立索引间隔（秒）；远程没有定期确认 */
  remoteIndexIntervalSec: number
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

/**
 * 一个目录的直接子项（扫描进程的枚举结果，缓存的条目）。不含子项 URI：调用方按与 provider 相同的方式
 * 由目录 URI 与 name 生成（file: 为 pathToFileURL(path.join(fileURLToPath(dir), name))，sftp: 为
 * sftpChildUri），缓存以此为键。远程目录的列表由主进程经 remoteResult 传给扫描进程（协议的
 * RawEntrySchema 与本类型一致）。
 */
export interface RawEntry {
  name: string
  kind: 'file' | 'directory' | 'symlink'
  /** 只有 symlink 才有：链接目标的类型；目标不存在或无法读取时为 null */
  target?: 'file' | 'directory' | null
  /** 文件的字节数；目录与链接为 0 */
  size: number
  /** 修改时间（Unix 毫秒，可带小数，与 fs.Stats.mtimeMs 相同） */
  mtime: number
  hidden: boolean
  /** 属主名（远程目录：SFTP longname 的第 3 列；本地与取不到时没有） */
  owner?: string
}
