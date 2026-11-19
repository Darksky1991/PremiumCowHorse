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
