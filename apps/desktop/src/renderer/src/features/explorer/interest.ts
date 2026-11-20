import { VFS_INTEREST_OFFSCREEN_MAX, VFS_INTEREST_VISIBLE_MAX } from '@pch/shared'
import type { TreeInterest } from '@renderer/data/vfs'
import type { TreeNode } from './tree-model'

/** 虚拟滚动实际渲染的行范围（含 overscan，两端都包含）；没有渲染任何行时为 null */
export interface RowRange {
  start: number
  end: number
}

/** 已展开的真实目录（条目根、目录、链接目录；加载中 / 出错的也算——它们仍在被列出） */
function isExpandedDirectory(n: TreeNode): n is TreeNode & { uri: string } {
  return (
    n.expanded &&
    n.uri !== null &&
    n.status === undefined &&
    (n.kind === 'folder' || n.kind === 'directory' || n.kind === 'link-directory')
  )
}

/**
 * 选中节点 → 关注点目录（设计 4.5）：目录节点（条目根、目录、链接目录）为自身 URI；
 * 文件 / 链接文件 / 失效链接为其父目录；分组、状态行为 null。
 * 文件条目（工作区中固定的单个文件）的父目录不在任何根之下、也不在树中，同样为 null。
 */
function focusOf(
  selected: TreeNode | undefined,
  byId: ReadonlyMap<string, TreeNode>
): string | null {
  if (!selected || selected.status !== undefined || selected.uri === null) return null
  switch (selected.kind) {
    case 'folder':
    case 'directory':
    case 'link-directory':
      return selected.uri
    case 'file':
    case 'link-file':
    case 'link-broken': {
      if (selected.source === 'entry') return null
      const parent = selected.parentId === null ? undefined : byId.get(selected.parentId)
      return parent?.uri ?? null
    }
    case 'group':
      return null
  }
}

/**
 * 资源树 → 告诉扫描进程的关注点（vfs.interest 中资源树的部分，设计 4.6；标签的部分见 features/tabs）。
 * visible：视口内（range 内的行）所属的已展开目录，以及行本身为已展开目录者；
 * offscreen：其余已展开目录。都按树中自上而下的顺序、去重，超过 IPC 上限时截断。
 */
export function interestFromTree(
  nodes: readonly TreeNode[],
  range: RowRange | null,
  selectedId: string | null
): TreeInterest {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const visible = new Set<string>()
  if (range !== null) {
    const end = Math.min(range.end, nodes.length - 1)
    for (let i = Math.max(0, range.start); i <= end; i++) {
      const n = nodes[i]!
      const parent = n.parentId === null ? undefined : byId.get(n.parentId)
      // 先父后子，保持自上而下的顺序
      if (parent && isExpandedDirectory(parent)) visible.add(parent.uri)
      if (isExpandedDirectory(n)) visible.add(n.uri)
    }
  }
  const ordered = (uris: Iterable<string>): string[] => {
    const set = new Set(uris)
    const out: string[] = []
    for (const n of nodes) {
      if (isExpandedDirectory(n) && set.has(n.uri)) {
        out.push(n.uri)
        set.delete(n.uri)
      }
    }
    return out
  }
  const offscreen = new Set<string>()
  for (const n of nodes) if (isExpandedDirectory(n) && !visible.has(n.uri)) offscreen.add(n.uri)
  return {
    focus: focusOf(selectedId === null ? undefined : byId.get(selectedId), byId),
    visible: ordered(visible).slice(0, VFS_INTEREST_VISIBLE_MAX),
    offscreen: [...offscreen].slice(0, VFS_INTEREST_OFFSCREEN_MAX)
  }
}
