/** 默认工作区：由迁移写入，不可删除；name 为空字符串时界面显示本地化的默认名称 */
export const DEFAULT_WORKSPACE_ID = 'default'

export interface Workspace {
  id: string
  name: string
  description: string | null
  color: string | null
  sortOrder: number
  archived: boolean
  /** 最近一次切换到该工作区的时间；最大者即「当前工作区」 */
  lastOpenedAt: number | null
  createdAt: number
  updatedAt: number
}

/** group：纯组织用的虚拟分组；folder / file：指向真实目录 / 文件的 URI */
export type EntryKind = 'group' | 'folder' | 'file'

export interface EntryMeta {
  note?: string
  icon?: string
  color?: string
}

export interface WorkspaceEntry {
  id: string
  workspaceId: string
  /** null 为根；只能指向同一工作区的 group */
  parentId: string | null
  kind: EntryKind
  label: string
  /** group 为 null */
  uri: string | null
  sortOrder: number
  meta: EntryMeta | null
  createdAt: number
  updatedAt: number
}
