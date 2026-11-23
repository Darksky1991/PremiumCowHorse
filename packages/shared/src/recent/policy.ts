import type { LayoutLocationKind, OpenSource } from '../layout/types'

/**
 * 一次打开是否记入「最近使用」（M5 D1）：
 * 只有文件与目录会记；tree-open / palette / overview 文件与目录都记，plugin 只记文件
 * （目录视图逐级进入不记），tree-select / address / history / 未指定不记。
 * 放在 shared 是因为 tabs-store（只能依赖 shared）需要据此决定是否发出记录信号。
 */
export function shouldRecordRecent(
  kind: LayoutLocationKind,
  source: OpenSource | undefined
): boolean {
  if (kind !== 'file' && kind !== 'directory') return false
  switch (source) {
    case 'tree-open':
    case 'palette':
    case 'overview':
      return true
    case 'plugin':
      return kind === 'file'
    default:
      return false
  }
}
