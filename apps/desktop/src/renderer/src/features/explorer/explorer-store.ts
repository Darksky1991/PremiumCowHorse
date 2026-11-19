import { create } from 'zustand'

interface ExplorerState {
  /** 工作区 id → 已展开的节点 id（折叠祖先时保留子孙的展开记录，再次展开时恢复） */
  expanded: Record<string, string[]>
  /** 工作区 id → 选中的节点 id */
  selected: Record<string, string | null>
  toggle: (workspaceId: string, nodeId: string) => void
  /** 展开这些节点（已展开的不变）：在树中定位时一次展开所有祖先 */
  expand: (workspaceId: string, nodeIds: readonly string[]) => void
  select: (workspaceId: string, nodeId: string | null) => void
}

/**
 * 资源树的展开 / 选择状态，按工作区区分。
 * M3 起纳入会话快照（SessionSnapshot.explorer）持久化，本阶段只保存在内存中。
 */
export const useExplorerStore = create<ExplorerState>((set) => ({
  expanded: {},
  selected: {},
  toggle: (workspaceId, nodeId) =>
    set((s) => {
      const current = s.expanded[workspaceId] ?? []
      const next = current.includes(nodeId)
        ? current.filter((id) => id !== nodeId)
        : [...current, nodeId]
      return { expanded: { ...s.expanded, [workspaceId]: next } }
    }),
  expand: (workspaceId, nodeIds) =>
    set((s) => {
      const current = s.expanded[workspaceId] ?? []
      const added = nodeIds.filter((id, i) => !current.includes(id) && nodeIds.indexOf(id) === i)
      if (added.length === 0) return s
      return { expanded: { ...s.expanded, [workspaceId]: [...current, ...added] } }
    }),
  select: (workspaceId, nodeId) =>
    set((s) => ({ selected: { ...s.selected, [workspaceId]: nodeId } }))
}))
