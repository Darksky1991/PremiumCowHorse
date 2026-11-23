import type { ConnectionState, ReachabilityEvent, Settings } from '@pch/shared'

/** 主进程内部事件。新增模块时在这里登记事件类型。 */
export interface MainEvents extends Record<string, unknown> {
  'settings.changed': Partial<Settings>
  /** 工作区或其条目发生变化（id 为工作区 id） */
  'workspace.changed': { id: string }
  /** 目录的缓存内容有变化（扫描进程） */
  'vfs.changed': { uri: string }
  /** 共享 / 卷断开或恢复（扫描进程） */
  'vfs.reachability': ReachabilityEvent
  /** 最近使用有变化（recent 模块；null = 清除了全部） */
  'recent.changed': { workspaceId: string | null }
  /** 连接列表有变化（connection 模块） */
  'connection.changed': Record<string, never>
  /** 连接状态变化（连接池） */
  'connection.status': { id: string; state: ConnectionState }
}
