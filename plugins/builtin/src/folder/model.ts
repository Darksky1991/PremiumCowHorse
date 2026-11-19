import type { FileEntry } from '@pch/plugin-sdk'

/** 列表的列（排序键） */
export type SortKey = 'name' | 'mtime' | 'type' | 'size'
export type SortDir = 'asc' | 'desc'
export interface Sort {
  key: SortKey
  dir: SortDir
}

export const DEFAULT_SORT: Sort = { key: 'name', dir: 'asc' }

/** 名称的比较：日语排序规则、数字按数值（file2 < file10），与资源树相同 */
const collator = new Intl.Collator('ja', { numeric: true })

/** 目录与指向目录的链接（排在前面，双击在标签内导航） */
export function isDirectoryLike(e: FileEntry): boolean {
  return e.kind === 'directory' || (e.kind === 'symlink' && e.target === 'directory')
}

/** 扩展名（小写、不带点）：最后一个点之后的部分；以点开头的名称（.gitignore）与没有点的名称为空 */
export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot <= 0 ? '' : name.slice(dot + 1).toLowerCase()
}

const byName = (a: FileEntry, b: FileEntry): number => collator.compare(a.name, b.name)

const KEY_COMPARE: Record<SortKey, (a: FileEntry, b: FileEntry) => number> = {
  name: byName,
  mtime: (a, b) => a.mtime - b.mtime,
  size: (a, b) => a.size - b.size,
  // 目录都在同一组，类型相同；文件按扩展名
  type: (a, b) =>
    isDirectoryLike(a) ? 0 : collator.compare(extensionOf(a.name), extensionOf(b.name))
}

/**
 * 列表的排序：目录（含指向目录的链接）始终在前；组内按列比较，降序时反转；
 * 按名称以外的列相等时按名称升序。返回新数组，不改变输入。
 */
export function sortEntries(
  entries: readonly FileEntry[],
  key: SortKey,
  dir: SortDir
): FileEntry[] {
  const sign = dir === 'asc' ? 1 : -1
  const compare = KEY_COMPARE[key]
  return [...entries].sort((a, b) => {
    const group = Number(isDirectoryLike(b)) - Number(isDirectoryLike(a))
    if (group !== 0) return group
    const c = compare(a, b) * sign
    if (c !== 0 || key === 'name') return c
    return byName(a, b)
  })
}

/** 「显示隐藏文件」关闭时去掉隐藏项；打开时原样返回 */
export function visibleEntries(
  entries: readonly FileEntry[],
  showHidden: boolean
): readonly FileEntry[] {
  return showHidden ? entries : entries.filter((e) => !e.hidden)
}

/** 标签的 viewState：排序（只在内存中，随标签保存；同一标签内导航时 layoutReducer 清除，回到默认） */
export interface FolderViewState {
  sort: Sort
}
