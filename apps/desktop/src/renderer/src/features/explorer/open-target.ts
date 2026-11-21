import { FALLBACK_PLUGIN_ID } from '@pch/plugin-sdk'
import type { TabTarget } from '@renderer/stores/tabs-store'
import type { NodeKind, TreeNode } from './tree-model'

const TAB_KIND: Partial<Record<NodeKind, TabTarget['kind']>> = {
  folder: 'directory',
  directory: 'directory',
  'link-directory': 'directory',
  file: 'file',
  'link-file': 'file'
}

/**
 * 节点在标签中打开的目标：条目根、真实目录 / 文件、指向目录 / 文件的链接可以打开；
 * 分组、状态行、失效链接与没有 URI 的节点返回 null。标题为节点显示名（条目为条目标签）。
 */
export function openTarget(node: TreeNode | null | undefined): TabTarget | null {
  if (!node || node.status !== undefined || node.uri === null) return null
  const kind = TAB_KIND[node.kind]
  return kind === undefined ? null : { uri: node.uri, kind, title: node.label }
}

/**
 * 资源树中发起打开的操作：
 * - select：单击、↑↓ 键盘移动后停留（设置 explorer.singleClickPreview 开启时）
 * - activate：双击、Enter
 * - newTab：Ctrl+单击、中键、Ctrl+Enter、菜单「在新标签页中打开」
 */
export type OpenGesture = 'select' | 'activate' | 'newTab'

/** 一次打开：目标、是否新标签、查看器（null = 自动选择并换掉当前查看器；省略 = 自动选择） */
export interface OpenRequest {
  target: TabTarget
  newTab: boolean
  viewer?: string | null
}

/**
 * 资源树的操作该打开什么（需求方反馈第 3 项）。文件节点（file / link-file）：
 * select → 当前标签以「文件信息」打开，当前标签已在显示该文件（无论哪个查看器）时什么都不做；
 * activate → 当前标签以默认查看器打开（已在显示该文件时换回默认）；newTab → 新标签、默认查看器。
 * 目录等其他可打开节点不指定查看器：select / activate 在当前标签、newTab 在新标签（行为不变）。
 * activeUri：该工作区激活标签的 URI（没有标签时为 null）。不可打开的节点返回 null
 */
export function openRequest(
  node: TreeNode | null | undefined,
  gesture: OpenGesture,
  activeUri: string | null
): OpenRequest | null {
  const target = openTarget(node)
  if (target === null) return null
  if (gesture === 'newTab') return { target, newTab: true }
  if (target.kind !== 'file') return { target, newTab: false }
  if (gesture === 'activate') return { target, newTab: false, viewer: null }
  return activeUri === target.uri ? null : { target, newTab: false, viewer: FALLBACK_PLUGIN_ID }
}
