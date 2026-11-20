import type { WorkspaceEntry } from '@pch/shared'
import { revealNodeIds } from './reveal'
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

/** 节点 id 的祖先（自上而下：分组 → 条目 → 中间目录）；状态行与无法解析的 id 为 null */
function ancestorIds(entries: readonly WorkspaceEntry[], nodeId: string): string[] | null {
  if (nodeId.endsWith(STATUS_SUFFIX)) return null
  if (nodeId.startsWith('entry:')) {
    const { chain } = revealNodeIds(entries, { entryId: nodeId.slice(6), segments: [] })
    return chain
  }
  // fs:<entryId>:<相对路径>（条目 id 为 UUID，不含冒号）
  const match = /^fs:([^:]+):(.+)$/.exec(nodeId)
  if (match === null) return null
  const { chain } = revealNodeIds(entries, {
    entryId: match[1] as string,
    segments: (match[2] as string).split('/')
  })
  return chain
}

/**
 * 选中项不在列表中、是因为某个祖先被折叠（抽屉互斥收起的顶层分组、全部折叠）时，最近的可见祖先的位置：
 * 树把该祖先显示为选中，但不改写 store 中的选中——重新展开后原来的选中项恢复（Review Focus 5）。
 * 最近的可见祖先已展开、但子项尚未加载（状态行为加载中 / 出错）时同样视为被挡住。
 * 选中项可见、是状态行、最近的可见祖先已展开且子项已加载（节点已被删除）或祖先都不在时为 -1（按 resolveSelection）。
 */
export function hiddenSelectionIndex(
  nodes: readonly TreeNode[],
  entries: readonly WorkspaceEntry[],
  selectedId: string | null
): number {
  if (selectedId === null || nodes.some((n) => n.id === selectedId)) return -1
  const ancestors = ancestorIds(entries, selectedId)
  if (ancestors === null) return -1
  for (let i = ancestors.length - 1; i >= 0; i--) {
    const id = ancestors[i] as string
    const index = nodes.findIndex((n) => n.id === id)
    if (index === -1) continue
    if (!nodes[index]?.expanded) return index
    // 展开但子项尚未加载（只有「加载中 / 出错」状态行；如抽屉收起期间缓存被回收后重新展开）：
    // 选中项可能还在，同样视为被挡住，加载完成后恢复
    const status = nodes.find((n) => n.id === `${id}${STATUS_SUFFIX}`)?.status
    return status === 'loading' || status === 'error' ? index : -1
  }
  return -1
}
