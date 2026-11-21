import type { TabLocation } from './types'

/** 工作区总览的内部 URI 的协议（不是文件系统：不发给扫描进程、不进 vfs.interest、树不定位它） */
export const WORKSPACE_URI_SCHEME = 'pch-workspace:'

/** 工作区总览的 URI：`pch-workspace:<id>` */
export function workspaceUri(workspaceId: string): string {
  return `${WORKSPACE_URI_SCHEME}${workspaceId}`
}

/** 工作区总览 URI 中的工作区 id；不是总览 URI 时为 null */
export function workspaceIdOfUri(uri: string): string | null {
  if (!uri.startsWith(WORKSPACE_URI_SCHEME)) return null
  const id = uri.slice(WORKSPACE_URI_SCHEME.length)
  return id === '' ? null : id
}

/** 工作区总览的位置（title 为工作区的显示名） */
export function workspaceLocation(workspaceId: string, title: string): TabLocation {
  return { uri: workspaceUri(workspaceId), kind: 'workspace', title }
}

/**
 * 工作区一览的内部 URI（M2 反馈第 8 项）：只有一页、不带 id。它是工作区总览的上一级，
 * 属于当前工作区的标签集；与总览一样不是文件系统（不发给扫描进程、不进 vfs.interest、树不定位它）。
 * 注意它不以 WORKSPACE_URI_SCHEME（`pch-workspace:`）开头，workspaceIdOfUri 对它返回 null
 */
export const WORKSPACES_URI = 'pch-workspaces:'

/** 是否为工作区一览的 URI */
export function isWorkspacesUri(uri: string): boolean {
  return uri === WORKSPACES_URI
}

/** 工作区一览的位置（title 为本地化的「工作区一览」） */
export function workspacesLocation(title: string): TabLocation {
  return { uri: WORKSPACES_URI, kind: 'workspaces', title }
}
