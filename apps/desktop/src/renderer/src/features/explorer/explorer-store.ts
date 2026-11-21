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

/**
 * 一个工作区的展开状态：已展开的节点，以及其中由「树跟随标签」展开的节点（followed ⊆ expanded）——
 * 所在目录本身，和同步时本来折叠、为显示目标而展开的祖先
 */
export interface FollowState {
  expanded: string[]
  followed: string[]
}

/**
 * 树跟随标签（sync 定位）开始时（纯函数，设计 2.4）：收起不在新位置上（不是新目标、也不在其祖先链上）的
 * 跟随展开节点，再展开新位置的祖先链（expandNodes，含抽屉互斥）。祖先链中本次新展开的节点（原本折叠）
 * 也记为跟随展开：离开时与所在目录本身一并收起，后退 / 上一级 / 去别处时树不越展越多。
 * 原本已展开的祖先与用户自己展开的节点保持不动、不记。抽屉互斥收起的节点移出跟随记录（followed ⊆ expanded）。
 * 没有变化时返回 current 本身。
 */
export function followTo(
  current: FollowState,
  chain: readonly string[],
  target: string,
  exclusive: readonly string[]
): FollowState {
  const stay = (id: string): boolean => id === target || chain.includes(id)
  const leaving = current.followed.filter((id) => !stay(id))
  const kept =
    leaving.length === 0 ? current.expanded : current.expanded.filter((id) => !leaving.includes(id))
  const expanded = expandNodes(kept, chain, exclusive)
  if (leaving.length === 0 && expanded === current.expanded) return current
  const opened = expanded.filter((id) => !kept.includes(id))
  const followed = [...current.followed.filter(stay), ...opened].filter((id) =>
    expanded.includes(id)
  )
  return { expanded, followed }
}

/**
 * 跟随的目标（目录）出现后展开它本身并记为跟随展开（纯函数）。已展开的（用户展开、或作为祖先展开的）
 * 不动、不记——离开时不替用户收起。没有变化时返回 current 本身。
 */
export function openFollowed(current: FollowState, nodeId: string): FollowState {
  if (current.expanded.includes(nodeId)) return current
  return { expanded: [...current.expanded, nodeId], followed: [...current.followed, nodeId] }
}

interface ExplorerState {
  /** 工作区 id → 已展开的节点 id（折叠祖先时保留子孙的展开记录，再次展开时恢复） */
  expanded: Record<string, string[]>
  /** 工作区 id → 已展开的节点中由树跟随标签展开的节点（用户折叠 / 展开该节点、全部折叠时移出） */
  followed: Record<string, string[]>
  /** 工作区 id → 选中的节点 id */
  selected: Record<string, string | null>
  /** exclusive：互斥展开的顶层分组（tree-model 的 drawerIds）；缺省为没有 */
  toggle: (workspaceId: string, nodeId: string, exclusive?: readonly string[]) => void
  /** 展开这些节点（已展开的不变）：在树中定位时一次展开所有祖先 */
  expand: (workspaceId: string, nodeIds: readonly string[], exclusive?: readonly string[]) => void
  /** 树跟随标签（sync）开始：收起离开的跟随展开目录，展开新位置的祖先链（followTo） */
  followTo: (
    workspaceId: string,
    chain: readonly string[],
    target: string,
    exclusive?: readonly string[]
  ) => void
  /** 跟随的目标目录出现后展开它本身（openFollowed） */
  openFollowed: (workspaceId: string, nodeId: string) => void
  /** 全部折叠：收起该工作区所有已展开的目录与分组（选中不变） */
  collapseAll: (workspaceId: string) => void
  select: (workspaceId: string, nodeId: string | null) => void
}

const NONE: readonly string[] = []

/**
 * 把纯函数（followTo / openFollowed）的结果写回某个工作区；没有变化时返回 s 本身（不引起重新渲染）
 */
function applyFollow(
  s: ExplorerState,
  workspaceId: string,
  step: (current: FollowState) => FollowState
): Partial<ExplorerState> {
  const current = {
    expanded: s.expanded[workspaceId] ?? [],
    followed: s.followed[workspaceId] ?? []
  }
  const next = step(current)
  if (next === current) return s
  return {
    expanded: { ...s.expanded, [workspaceId]: next.expanded },
    followed: { ...s.followed, [workspaceId]: next.followed }
  }
}

/**
 * 资源树的展开 / 选择状态，按工作区区分。
 * M3 起纳入会话快照（SessionSnapshot.explorer）持久化，本阶段只保存在内存中。
 */
export const useExplorerStore = create<ExplorerState>((set) => ({
  expanded: {},
  followed: {},
  selected: {},
  // 用户切换的节点从此归用户所有：从跟随展开中移出（离开时不再替用户收起）
  toggle: (workspaceId, nodeId, exclusive = NONE) =>
    set((s) => {
      const next = toggleExpanded(s.expanded[workspaceId] ?? [], nodeId, exclusive)
      const followed = s.followed[workspaceId] ?? []
      return {
        expanded: { ...s.expanded, [workspaceId]: next },
        followed: followed.includes(nodeId)
          ? { ...s.followed, [workspaceId]: followed.filter((id) => id !== nodeId) }
          : s.followed
      }
    }),
  expand: (workspaceId, nodeIds, exclusive = NONE) =>
    set((s) => {
      const current = s.expanded[workspaceId] ?? []
      const next = expandNodes(current, nodeIds, exclusive)
      if (next === current) return s
      return { expanded: { ...s.expanded, [workspaceId]: next } }
    }),
  followTo: (workspaceId, chain, target, exclusive = NONE) =>
    set((s) => applyFollow(s, workspaceId, (c) => followTo(c, chain, target, exclusive))),
  openFollowed: (workspaceId, nodeId) =>
    set((s) => applyFollow(s, workspaceId, (c) => openFollowed(c, nodeId))),
  collapseAll: (workspaceId) =>
    set((s) =>
      (s.expanded[workspaceId] ?? []).length === 0
        ? s
        : {
            expanded: { ...s.expanded, [workspaceId]: [] },
            followed: { ...s.followed, [workspaceId]: [] }
          }
    ),
  select: (workspaceId, nodeId) =>
    set((s) =>
      s.selected[workspaceId] === nodeId
        ? s
        : { selected: { ...s.selected, [workspaceId]: nodeId } }
    )
}))
