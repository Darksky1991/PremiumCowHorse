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
