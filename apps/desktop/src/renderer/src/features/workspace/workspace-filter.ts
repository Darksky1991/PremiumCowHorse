import { matchScore } from '@renderer/lib/text-match'

/** 可筛选的一项：名称为显示名（默认工作区为本地化名） */
export interface FilterableWorkspace {
  id: string
  name: string
  description: string | null
}

/**
 * 工作区的筛选（圆环 / 列表 / 菜单式共用，设计稿 1.8）：匹配名称与说明，结果保持原顺序，
 * best 为最佳匹配的下标（名称前缀 > 名称包含 > 说明包含，同分取靠前者）。
 * 查询为空或只有空白时全部匹配、没有最佳匹配（best = -1）：调用方据此保持当前项，
 * 不能把「第 1 项」当作最佳匹配（菜单式的 Enter 曾因此切走）
 */
export function filterWorkspaces<T extends FilterableWorkspace>(
  items: readonly T[],
  query: string
): { matches: T[]; best: number } {
  if (query.trim() === '') return { matches: [...items], best: -1 }
  const matches: T[] = []
  let best = -1
  let bestScore = -1
  for (const w of items) {
    const score = matchScore(query, w.name, w.description)
    if (score === null) continue
    if (score > bestScore) {
      bestScore = score
      best = matches.length
    }
    matches.push(w)
  }
  return { matches, best }
}
