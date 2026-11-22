import { isLocalUri } from '@renderer/lib/display-path'
import { isStatusNode } from './drag-drop'
import type { TreeNode } from './tree-model'

/** 右键菜单项；数组中的 'separator' 为分隔线 */
export type MenuItemId =
  | 'openInNewTab'
  | 'newGroup'
  | 'addFolder'
  | 'addFile'
  | 'addRemoteFolder'
  | 'reveal'
  | 'cacheStrategy'
  | 'buildIndex'
  | 'copyPath'
  | 'copyUri'
  | 'pinToRoot'
  | 'rename'
  | 'remove'
  | 'separator'

/**
 * 节点对应的右键菜单项（可打开的节点以「在新标签页中打开」开头，设计 2.8）。node 为 null 表示树的空白处；状态行没有菜单（返回空数组）。
 * 全部是条目管理、只读操作或应用自身的设置（缓存策略、索引）：没有任何会修改磁盘文件的项。
 * 远程（非 file:）节点没有「在资源管理器中显示」与「缓存策略」（M4 设计 5.8：远程目录只在展开 / 选中 / 索引时读取）
 */
export function menuItemsFor(node: TreeNode | null): MenuItemId[] {
  if (node === null) return ['newGroup', 'separator', 'addFolder', 'addFile', 'addRemoteFolder']
  if (isStatusNode(node)) return []
  const items = itemsForNode(node)
  return node.uri !== null && !isLocalUri(node.uri)
    ? items.filter((id) => id !== 'reveal' && id !== 'cacheStrategy')
    : items
}

function itemsForNode(node: TreeNode): MenuItemId[] {
  if (node.source === 'entry') {
    if (node.kind === 'group') return ['newGroup', 'separator', 'rename', 'remove']
    return [
      'openInNewTab',
      'separator',
      'reveal',
      'copyPath',
      'copyUri',
      'separator',
      // 缓存策略与索引只对目录条目有意义
      ...(node.kind === 'folder' ? (['cacheStrategy', 'buildIndex', 'separator'] as const) : []),
      'rename',
      'remove'
    ]
  }

  // 真实子项：失效链接没有可打开的目标，也不能固定为条目；只有真实子目录可以建立索引
  return [
    ...(node.kind === 'link-broken' ? [] : (['openInNewTab', 'separator'] as const)),
    'reveal',
    'copyPath',
    'copyUri',
    ...(node.kind === 'directory' ? (['separator', 'buildIndex'] as const) : []),
    ...(node.kind === 'link-broken' ? [] : (['separator', 'pinToRoot'] as const))
  ]
}

/** F2 / Delete 作用的节点：只有条目（含分组），状态行与真实子项无效 */
export function isEntryNode(node: TreeNode | undefined): node is TreeNode {
  return node !== undefined && node.source === 'entry' && !isStatusNode(node)
}
