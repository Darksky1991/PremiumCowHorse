import type { Settings } from '@pch/shared'

/** 主进程内部事件。新增模块时在这里登记事件类型。 */
export interface MainEvents extends Record<string, unknown> {
  'settings.changed': Partial<Settings>
  /** 工作区或其条目发生变化（id 为工作区 id） */
  'workspace.changed': { id: string }
}
