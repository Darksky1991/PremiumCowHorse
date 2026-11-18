import type { TreeNode } from './tree-model'

const STATUS_SUFFIX = '#status'

/**
 * 求选中项在当前节点中的位置；选中的节点已不在列表中时回退，避免选择丢失后 ↑↓ 跳回第 0 行：
 * - 状态行（`<父 id>#status`）消失（加载完成 / 重试成功）→ 回到其父节点；
 * - 其他情况（节点被删除、父节点也不在了）→ 停在上一次的位置（钳制到末行）。
 * 没有选中项或没有可回退的位置时返回 -1。
 */
export function resolveSelection(
  nodes: readonly TreeNode[],
  selectedId: string | null,
  lastIndex: number
): number {
  if (selectedId === null || nodes.length === 0) return -1
  const index = nodes.findIndex((n) => n.id === selectedId)
  if (index >= 0) return index

  if (selectedId.endsWith(STATUS_SUFFIX)) {
    const parentId = selectedId.slice(0, -STATUS_SUFFIX.length)
    const parent = nodes.findIndex((n) => n.id === parentId)
    if (parent >= 0) return parent
  }
  return lastIndex >= 0 ? Math.min(lastIndex, nodes.length - 1) : -1
}
