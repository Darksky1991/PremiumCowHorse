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

/**
 * 桌面记录页的内部 URI（M3）：`pch-desktop:<快照 id>` 或 `pch-desktop:current`（现场）。
 * 与工作区一览同样不是文件系统（不发给扫描进程、不进 vfs.interest、树不定位它）
 */
export const DESKTOP_URI_SCHEME = 'pch-desktop:'

/** 桌面记录页的 URI */
export function desktopUri(id: number | 'current'): string {
  return `${DESKTOP_URI_SCHEME}${id}`
}

/** 桌面记录 URI 中的快照 id（或 'current'）；不是桌面记录 URI 或 id 非法时为 null */
export function desktopIdOfUri(uri: string): number | 'current' | null {
  if (!uri.startsWith(DESKTOP_URI_SCHEME)) return null
  const rest = uri.slice(DESKTOP_URI_SCHEME.length)
  if (rest === 'current') return 'current'
  return /^\d+$/.test(rest) ? Number(rest) : null
}

/** 桌面记录页的位置（title 为快照标题） */
export function desktopLocation(id: number | 'current', title: string): TabLocation {
  return { uri: desktopUri(id), kind: 'desktop', title }
}

/** 设置页的内部 URI（M5）：单页、无参数；与工作区一览同样不是文件系统 */
export const SETTINGS_URI = 'pch-settings:'

/** 是否为设置页的 URI */
export function isSettingsUri(uri: string): boolean {
  return uri === SETTINGS_URI
}

/** 设置页的位置（title 为本地化的「设置」） */
export function settingsLocation(title: string): TabLocation {
  return { uri: SETTINGS_URI, kind: 'settings', title }
}

/** 关于页的内部 URI（M5）：单页、无参数；与工作区一览同样不是文件系统 */
export const ABOUT_URI = 'pch-about:'

/** 是否为关于页的 URI */
export function isAboutUri(uri: string): boolean {
  return uri === ABOUT_URI
}

/** 关于页的位置（title 为本地化的「关于」） */
export function aboutLocation(title: string): TabLocation {
  return { uri: ABOUT_URI, kind: 'about', title }
}
