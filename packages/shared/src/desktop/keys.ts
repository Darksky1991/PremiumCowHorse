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
