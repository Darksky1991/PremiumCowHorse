import type { DesktopItem } from '@pch/shared'

/** 显示名中需要本地化的文字（纯函数不依赖 i18n 实例，调用方按当前语言提供） */
export interface LabelText {
  /** `::{CLSID}` 形式的特殊位置（如「此电脑」「回收站」） */
  specialLocation: string
  /** Explorer 多标签时的后缀，如「（3 个标签）」 */
  tabCount: (count: number) => string
}

/** 路径 / URI 的最后一段（忽略结尾分隔符）；没有时用整串 */
function lastSegment(path: string): string {
  const parts = path.split(/[\\/]/).filter((p) => p !== '')
  return parts.at(-1) ?? path
}

function tabText(tab: string, text: LabelText): string {
  return tab.startsWith('::{') ? text.specialLocation : tab
}

/**
 * 项目在清单中的显示：title 是主文字，detail 是次要文字（完整路径，空串表示没有）。
 * - Explorer：第一个标签 + 「（N 个标签）」（N > 1），详情为其余标签；
 * - Office：文件名 + 完整路径；VS Code / Eclipse：最后一段 + 完整路径。
 */
export function itemLabel(item: DesktopItem, text: LabelText): { title: string; detail: string } {
  switch (item.kind) {
    case 'explorer': {
      const [first = '', ...rest] = item.tabs
      const suffix = item.tabs.length > 1 ? text.tabCount(item.tabs.length) : ''
      return {
        title: `${tabText(first, text)}${suffix}`,
        detail: rest.map((tab) => tabText(tab, text)).join(' | ')
      }
    }
    case 'office':
      return { title: lastSegment(item.path), detail: item.path }
    case 'vscode':
      return { title: lastSegment(item.target), detail: item.target }
    case 'eclipse':
      return { title: lastSegment(item.workspace), detail: item.workspace }
  }
}
