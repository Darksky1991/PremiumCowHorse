import type { SearchKindFilter } from '@pch/shared'

/** 集中管理 query key，主进程事件到缓存失效的桥接也依赖这里 */
export const queryKeys = {
  appInfo: ['app', 'info'] as const,
  settings: ['settings'] as const,
  /** 缓存占用（设置页）；清空缓存后失效 */
  cacheInfo: ['vfs', 'cache-info'] as const,
  windowState: ['window', 'state'] as const,
  /** 'workspace' 前缀用于一次性使工作区相关缓存失效 */
  workspaceRoot: ['workspace'] as const,
  workspaces: ['workspace', 'list'] as const,
  activeWorkspace: ['workspace', 'active'] as const,
  entries: (workspaceId: string) => ['entry', 'list', workspaceId] as const,
  /** 工作区的「建立索引」目录（URI 列表） */
  indexTargets: (workspaceId: string) => ['entry', 'index', workspaceId] as const,
  /** 所有目录列表的前缀（手动刷新时一次性失效） */
  directoryRoot: ['vfs', 'list'] as const,
  directory: (uri: string) => ['vfs', 'list', uri] as const,
  /** 单个资源的 stat（预览标签的文件信息）；前缀用于按父目录失效 */
  statRoot: ['vfs', 'stat'] as const,
  stat: (uri: string) => ['vfs', 'stat', uri] as const,
  /** 桌面记录：快照列表、单个快照（含项目）、当前现场 */
  desktopSnapshots: ['desktop', 'list'] as const,
  desktopSnapshotRoot: ['desktop', 'snapshot'] as const,
  desktopSnapshot: (id: number) => ['desktop', 'snapshot', id] as const,
  desktopCurrent: ['desktop', 'current'] as const,
  /** 远程连接：'connection' 前缀用于连接变化时一次性失效 */
  connectionRoot: ['connection'] as const,
  connections: ['connection', 'list'] as const,
  /** 连接的主目录（登录用户为 realpath('.')；切换身份为 /） */
  connectionHome: (id: string, identity: string | null) =>
    ['connection', 'home', id, identity] as const,
  /**
   * 最近使用：'recent' 前缀用于一次性失效；limit 不进 key（调用方取同一个条数，
   * 不同条数共享缓存时以先到者为准——命令面板固定取 8 条）
   */
  recentRoot: ['recent'] as const,
  recent: (workspaceId: string) => ['recent', workspaceId] as const,
  /** 文件名搜索（只查缓存）；kind 为类型筛选 */
  search: (workspaceId: string, text: string, kind: SearchKindFilter) =>
    ['search', workspaceId, text, kind] as const,
  /** 命令面板的文件组（固定 kind 与 limit，不与搜索视图共享缓存） */
  paletteFiles: (workspaceId: string, text: string) => ['palette-files', workspaceId, text] as const
}
