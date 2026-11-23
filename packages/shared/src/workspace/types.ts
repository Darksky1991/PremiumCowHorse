import type { CacheStrategy } from '../scanner/types'
import type { WorkspaceColor } from './colors'

/** 工作区选择器的摘要：条目总数与根级前几项（只查 pch.db） */
export interface WorkspaceSummary {
  id: string
  /** 该工作区全部条目数（含分组下的） */
  entryCount: number
  /** 根级条目按 sort_order 的前 WORKSPACE_SUMMARY_TOP 个 */
  topEntries: { kind: 'folder' | 'file' | 'group'; label: string; uri: string | null }[]
}

export const WORKSPACE_SUMMARY_TOP = 4

/** 默认工作区：由迁移写入，不可删除；name 为空字符串时界面显示本地化的默认名称 */
export const DEFAULT_WORKSPACE_ID = 'default'

export interface Workspace {
  id: string
  name: string
  description: string | null
  /** 颜色键（WORKSPACE_COLORS）或 null */
  color: WorkspaceColor | null
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
  /** 条目级缓存策略；null = 沿用全局默认。folder 以外恒为 null */
  cacheStrategy: CacheStrategy | null
  createdAt: number
  updatedAt: number
}
