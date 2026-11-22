import type { DesktopItem } from './types'

/**
 * 同一对象的稳定标识（路径不区分大小写），用于「已开着」比较与勾选。
 * Explorer 的 key 包含标签顺序：顺序不同视为不同
 */
export function desktopItemKey(item: DesktopItem): string {
  switch (item.kind) {
    case 'explorer':
      return `explorer:${item.tabs.map((t) => t.toLowerCase()).join('|')}`
    case 'office':
      return `office:${item.path.toLowerCase()}`
    case 'vscode':
      return `vscode:${item.target.toLowerCase()}`
    case 'eclipse':
      return `eclipse:${item.workspace.toLowerCase()}`
  }
}

/**
 * 现场中开着的单个目标集合：Explorer 每个标签一项 `explorer-tab:<路径小写>`，其余同 key。
 * 恢复时据此跳过已开着的项目（Explorer 只要第一个标签的路径已开着就跳过整个窗口）
 */
export function openTargetsOf(items: DesktopItem[]): Set<string> {
  const set = new Set<string>()
  for (const item of items) {
    if (item.kind === 'explorer') {
      for (const tab of item.tabs) set.add(`explorer-tab:${tab.toLowerCase()}`)
    } else {
      set.add(desktopItemKey(item))
    }
  }
  return set
}

/** 项目数的统一算法（清单的勾选单位）：Explorer 每个标签算一项，其余每个项目一项 */
export function desktopEntryCount(items: readonly DesktopItem[]): number {
  return items.reduce((n, item) => n + (item.kind === 'explorer' ? item.tabs.length : 1), 0)
}

/**
 * 按选中的标签取项目的子集：tabs 省略或非 Explorer → 原项目；Explorer 只保留选中下标的标签
 * （按原顺序，重复与越界忽略）；一个都不剩 → null
 */
export function pickTabs(
  item: DesktopItem,
  tabs: readonly number[] | undefined
): DesktopItem | null {
  if (tabs === undefined || item.kind !== 'explorer') return item
  const wanted = new Set(tabs)
  const kept = item.tabs.filter((_, i) => wanted.has(i))
  return kept.length === 0 ? null : { ...item, tabs: kept }
}
