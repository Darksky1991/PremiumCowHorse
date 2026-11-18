/** 集中管理 query key，主进程事件到缓存失效的桥接也依赖这里 */
export const queryKeys = {
  appInfo: ['app', 'info'] as const,
  settings: ['settings'] as const,
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
  directory: (uri: string) => ['vfs', 'list', uri] as const
}
