import type { WorkspaceEntry } from '@pch/shared'

/** 工作区总览的一个分节：group 为 null 时是未分组的项（没有标题） */
export interface OverviewSection {
  group: WorkspaceEntry | null
  /** 该层的 folder / file 条目（按 sortOrder） */
  items: Array<WorkspaceEntry & { uri: string }>
  /** 子分组 */
  children: OverviewSection[]
  /** 0：未分组；1：顶层分组；2…：子分组 */
  depth: number
}

/**
 * 条目 → 总览的分节：未分组的项在最前（没有时不产生该分节），之后是顶层分组；
 * 分组内先列项、再列子分组。同层按 sortOrder（与资源树相同）
 */
export function overviewSections(entries: readonly WorkspaceEntry[]): OverviewSection[] {
  const childrenOf = new Map<string | null, WorkspaceEntry[]>()
  for (const e of entries) {
    const list = childrenOf.get(e.parentId)
    if (list) list.push(e)
    else childrenOf.set(e.parentId, [e])
  }
  for (const list of childrenOf.values()) list.sort((a, b) => a.sortOrder - b.sortOrder)

  const itemsOf = (parentId: string | null): OverviewSection['items'] =>
    (childrenOf.get(parentId) ?? []).filter(
      (e): e is WorkspaceEntry & { uri: string } => e.kind !== 'group' && e.uri !== null
    )
  const groupsOf = (parentId: string | null, depth: number): OverviewSection[] =>
    (childrenOf.get(parentId) ?? [])
      .filter((e) => e.kind === 'group')
      .map((group) => ({
        group,
        items: itemsOf(group.id),
        children: groupsOf(group.id, depth + 1),
        depth
      }))

  const ungrouped = itemsOf(null)
  const top = groupsOf(null, 1)
  return ungrouped.length > 0
    ? [{ group: null, items: ungrouped, children: [], depth: 0 }, ...top]
    : top
}
