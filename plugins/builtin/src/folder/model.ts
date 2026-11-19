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

/** 面包屑的一段：显示名与该层目录的 URI */
export interface Crumb {
  label: string
  uri: string
}

function decode(segment: string): string {
  try {
    return decodeURIComponent(segment)
  } catch {
    return segment
  }
}

/**
 * file URI 的完整路径段：本地从驱动器（`C:` → `file:///C:/`）、UNC 从共享（`\\srv\share` →
 * `file://srv/share`）开始。各段 URI 由原 URI 的编码段拼接（不重新编码，与资源树、缓存的 URI 一致）。
 * 不是 file URI 或无法分段时为 null。
 */
function fullCrumbs(uri: string): Crumb[] | null {
  const m = /^file:\/\/([^/]*)(\/.*)?$/i.exec(uri)
  if (!m) return null
  const host = m[1] ?? ''
  const segments = (m[2] ?? '').split('/').filter(Boolean)
  const [first, ...rest] = segments
  if (first === undefined) return null
  let current: string
  let crumbs: Crumb[]
  if (host === '') {
    current = `file:///${first}`
    crumbs = [{ label: decode(first), uri: `${current}/` }]
  } else {
    current = `file://${host}/${first}`
    crumbs = [{ label: `\\\\${decode(host)}\\${decode(first)}`, uri: current }]
  }
  for (const segment of rest) {
    current = `${current}/${segment}`
    crumbs.push({ label: decode(segment), uri: current })
  }
  return crumbs
}

/**
 * 面包屑：从所属条目的根开始（rootUri 为 null 或不是 uri 的祖先时，从驱动器 / 共享开始）。
 * 不是 file URI 时只有一段（URI 本身）。
 */
export function breadcrumb(uri: string, rootUri: string | null): Crumb[] {
  const crumbs = fullCrumbs(uri)
  if (crumbs === null) return [{ label: uri, uri }]
  if (rootUri === null) return crumbs
  const start = crumbs.findIndex((c) => c.uri === rootUri)
  return start < 0 ? crumbs : crumbs.slice(start)
}

/** 上一级目录（与条目根无关，可以越过条目根）；已在驱动器 / 共享根或不是 file URI 时为 null */
export function parentOf(uri: string): string | null {
  const crumbs = fullCrumbs(uri)
  return crumbs !== null && crumbs.length >= 2 ? crumbs[crumbs.length - 2]!.uri : null
}

/** 标签的 viewState：排序（只在内存中，随标签保存；同一标签内导航时 layoutReducer 清除，回到默认） */
export interface FolderViewState {
  sort: Sort
}
