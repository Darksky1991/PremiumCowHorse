import { isStatusNode } from './drag-drop'
import type { TreeNode } from './tree-model'

/** 右键菜单项；数组中的 'separator' 为分隔线 */
export type MenuItemId =
  | 'newGroup'
  | 'addFolder'
  | 'addFile'
  | 'reveal'
  | 'open'
  | 'copyPath'
  | 'copyUri'
  | 'pinToRoot'
  | 'rename'
  | 'remove'
  | 'separator'

/**
 * 节点对应的右键菜单项。node 为 null 表示树的空白处；状态行没有菜单（返回空数组）。
 * 全部是条目管理或只读操作：没有任何会修改磁盘文件的项。
 */
export function menuItemsFor(node: TreeNode | null): MenuItemId[] {
  if (node === null) return ['newGroup', 'separator', 'addFolder', 'addFile']
  if (isStatusNode(node)) return []

  if (node.source === 'entry') {
    if (node.kind === 'group') return ['newGroup', 'separator', 'rename', 'remove']
    return [
      'reveal',
      ...(node.kind === 'file' ? (['open'] as const) : []),
      'copyPath',
      'copyUri',
      'separator',
      'rename',
      'remove'
    ]
  }

  // 真实子项：失效链接没有可打开的目标，也不能固定为条目
  const isFile = node.kind === 'file' || node.kind === 'link-file'
  return [
    'reveal',
    ...(isFile ? (['open'] as const) : []),
    'copyPath',
    'copyUri',
    ...(node.kind === 'link-broken' ? [] : (['separator', 'pinToRoot'] as const))
  ]
}

/** F2 / Delete 作用的节点：只有条目（含分组），状态行与真实子项无效 */
export function isEntryNode(node: TreeNode | undefined): node is TreeNode {
  return node !== undefined && node.source === 'entry' && !isStatusNode(node)
}
