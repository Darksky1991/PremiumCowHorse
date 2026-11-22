import type { DesktopItem } from '@pch/shared'

/** 清单的项目：id 为字符串（「现在」用项目 key，快照用 String(项目 id)） */
export interface ChecklistItem {
  id: string
  item: DesktopItem
}

/** 选中结果：Explorer 带选中标签的下标（按原顺序）；其余项目没有 tabs */
export interface ChecklistPick {
  id: string
  tabs?: number[]
}

/**
 * Explorer 每个标签单独一张卡片，勾选单位是「项目 id + 标签下标」。
 * 分隔符用制表符：Windows 路径与快照项目 id 中都不会出现
 */
export function tabEntryId(id: string, tab: number): string {
  return `${id}\t${tab}`
}

/** 清单中全部可勾选单位的 id（Explorer 按标签展开），按清单顺序 */
export function entryIdsOf(items: readonly ChecklistItem[]): string[] {
  const out: string[] = []
  for (const { id, item } of items) {
    if (item.kind === 'explorer') item.tabs.forEach((_, i) => out.push(tabEntryId(id, i)))
    else out.push(id)
  }
  return out
}

/**
 * 勾选集合 → 选中的项目（按清单顺序）：Explorer 带选中标签的下标，一个都没选的窗口不出现；
 * 其余项目选中即出现
 */
export function picksOf(
  items: readonly ChecklistItem[],
  selected: ReadonlySet<string>
): ChecklistPick[] {
  const out: ChecklistPick[] = []
  for (const { id, item } of items) {
    if (item.kind === 'explorer') {
      const tabs = item.tabs.flatMap((_, i) => (selected.has(tabEntryId(id, i)) ? [i] : []))
      if (tabs.length > 0) out.push({ id, tabs })
    } else if (selected.has(id)) {
      out.push({ id })
    }
  }
  return out
}
