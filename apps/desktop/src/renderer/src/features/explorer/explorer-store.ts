import { create } from 'zustand'

/**
 * 分组抽屉的互斥（设计 2.7）：opened 中有顶层分组（exclusive）时，去掉其余顶层分组的展开标记。
 * 只去掉标记本身，被收起分组的子孙的展开记录保留，重新展开该分组时原样恢复（Review Focus 5）。
 */
function closeOtherDrawers(
  next: string[],
  opened: readonly string[],
  exclusive: readonly string[]
): string[] {
  const keep = opened.filter((id) => exclusive.includes(id))
  if (keep.length === 0) return next
  return next.filter((id) => !exclusive.includes(id) || keep.includes(id))
}

/**
 * 切换一个节点的展开状态（纯函数）。展开顶层分组（exclusive 中的 id）时收起其余顶层分组；
 * 子分组、条目、真实目录按普通节点切换。
 */
export function toggleExpanded(
  current: readonly string[],
  nodeId: string,
  exclusive: readonly string[]
): string[] {
  if (current.includes(nodeId)) return current.filter((id) => id !== nodeId)
  return closeOtherDrawers([...current, nodeId], [nodeId], exclusive)
}

/**
 * 展开这些节点（已展开的不变；纯函数）：在树中定位时一次展开所有祖先。
 * 祖先链经过顶层分组时按互斥规则收起其余顶层分组。没有变化时返回 current 本身。
 */
export function expandNodes(
  current: string[],
  nodeIds: readonly string[],
  exclusive: readonly string[]
): string[] {
  const added = nodeIds.filter((id, i) => !current.includes(id) && nodeIds.indexOf(id) === i)
  const next = closeOtherDrawers([...current, ...added], nodeIds, exclusive)
  return next.length === current.length && added.length === 0 ? current : next
}

interface ExplorerState {
  /** 工作区 id → 已展开的节点 id（折叠祖先时保留子孙的展开记录，再次展开时恢复） */
  expanded: Record<string, string[]>
  /** 工作区 id → 选中的节点 id */
  selected: Record<string, string | null>
  /** exclusive：互斥展开的顶层分组（tree-model 的 drawerIds）；缺省为没有 */
  toggle: (workspaceId: string, nodeId: string, exclusive?: readonly string[]) => void
  /** 展开这些节点（已展开的不变）：在树中定位时一次展开所有祖先 */
  expand: (workspaceId: string, nodeIds: readonly string[], exclusive?: readonly string[]) => void
  /** 全部折叠：收起该工作区所有已展开的目录与分组（选中不变） */
  collapseAll: (workspaceId: string) => void
  select: (workspaceId: string, nodeId: string | null) => void
}

const NONE: readonly string[] = []

/**
 * 资源树的展开 / 选择状态，按工作区区分。
 * M3 起纳入会话快照（SessionSnapshot.explorer）持久化，本阶段只保存在内存中。
 */
export const useExplorerStore = create<ExplorerState>((set) => ({
  expanded: {},
  selected: {},
  toggle: (workspaceId, nodeId, exclusive = NONE) =>
    set((s) => {
      const next = toggleExpanded(s.expanded[workspaceId] ?? [], nodeId, exclusive)
      return { expanded: { ...s.expanded, [workspaceId]: next } }
    }),
  expand: (workspaceId, nodeIds, exclusive = NONE) =>
    set((s) => {
      const current = s.expanded[workspaceId] ?? []
      const next = expandNodes(current, nodeIds, exclusive)
      if (next === current) return s
      return { expanded: { ...s.expanded, [workspaceId]: next } }
    }),
  collapseAll: (workspaceId) =>
    set((s) =>
      (s.expanded[workspaceId] ?? []).length === 0
        ? s
        : { expanded: { ...s.expanded, [workspaceId]: [] } }
    ),
  select: (workspaceId, nodeId) =>
    set((s) =>
      s.selected[workspaceId] === nodeId
        ? s
        : { selected: { ...s.selected, [workspaceId]: nodeId } }
    )
}))
