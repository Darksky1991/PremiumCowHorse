import type { ErrorCode, FileEntry, WorkspaceEntry } from '@pch/shared'
import type { DirectoryState } from '@renderer/data/vfs'

export type NodeKind =
  'group' | 'folder' | 'file' | 'directory' | 'link-directory' | 'link-file' | 'link-broken'

/**
 * 拍平后的一行。条目节点 id 为 `entry:<entryId>`，真实子项为 `fs:<entryId>:<相对路径>`；
 * 状态行（加载中 / 出错 / 空）为 `<父 id>#status`，其 kind / uri 沿用父节点（「重试」据 uri 重新获取）。
 */
export interface TreeNode {
  id: string
  parentId: string | null
  depth: number
  label: string
  kind: NodeKind
  source: 'entry' | 'fs'
  /** 所属的工作区条目（真实子项为其所在 folder 条目） */
  entryId: string
  uri: string | null
  expandable: boolean
  expanded: boolean
  status?: 'loading' | 'error' | 'empty'
  errorCode?: ErrorCode
}

export interface TreeInput {
  entries: WorkspaceEntry[]
  /** 已展开的节点 id */
  expanded: ReadonlySet<string>
  /** 目录 URI → 列表状态（缺失视为加载中） */
  directories: ReadonlyMap<string, DirectoryState>
  showHidden: boolean
}

const collator = new Intl.Collator('ja', { numeric: true })

function fsKind(item: FileEntry): NodeKind {
  if (item.kind === 'directory') return 'directory'
  if (item.kind === 'file') return 'file'
  // symlink：target 为 null（失效）或 undefined（读取失败的降级项）都不可展开
  if (item.target === 'directory') return 'link-directory'
  if (item.target === 'file') return 'link-file'
  return 'link-broken'
}

const isContainer = (kind: NodeKind): boolean => kind === 'directory' || kind === 'link-directory'

/**
 * 过滤与排序的结果按列表数组缓存：TanStack Query 在数据不变时返回同一数组，
 * 选择变化等重新渲染时不必对大目录重复排序。
 */
const sortedCache = new WeakMap<FileEntry[], { all?: FileEntry[]; visible?: FileEntry[] }>()

function sortedChildren(items: FileEntry[], showHidden: boolean): FileEntry[] {
  let cached = sortedCache.get(items)
  if (!cached) {
    cached = {}
    sortedCache.set(items, cached)
  }
  const slot = showHidden ? 'all' : 'visible'
  const hit = cached[slot]
  if (hit) return hit

  const result = (showHidden ? [...items] : items.filter((i) => !i.hidden)).sort((a, b) => {
    const dirA = isContainer(fsKind(a))
    const dirB = isContainer(fsKind(b))
    if (dirA !== dirB) return dirA ? -1 : 1
    return collator.compare(a.name, b.name)
  })
  cached[slot] = result
  return result
}

/** 把当前展开的节点拍平成一维数组（交给虚拟滚动） */
export function buildVisibleNodes(input: TreeInput): TreeNode[] {
  const { entries, expanded, directories, showHidden } = input
  const out: TreeNode[] = []

  const childrenOf = new Map<string | null, WorkspaceEntry[]>()
  for (const e of entries) {
    const list = childrenOf.get(e.parentId)
    if (list) list.push(e)
    else childrenOf.set(e.parentId, [e])
  }
  for (const list of childrenOf.values()) list.sort((a, b) => a.sortOrder - b.sortOrder)

  const pushStatus = (
    parent: TreeNode,
    status: NonNullable<TreeNode['status']>,
    errorCode?: ErrorCode
  ): void => {
    out.push({
      id: `${parent.id}#status`,
      parentId: parent.id,
      depth: parent.depth + 1,
      label: '',
      kind: parent.kind,
      source: parent.source,
      entryId: parent.entryId,
      uri: parent.uri,
      expandable: false,
      expanded: false,
      status,
      ...(errorCode !== undefined && { errorCode })
    })
  }

  /** 展开中的真实目录：列出子项，或产出一行状态 */
  const visitDirectory = (parent: TreeNode, relPath: string): void => {
    const state = parent.uri === null ? undefined : directories.get(parent.uri)
    if (state === undefined || state.status === 'loading') return pushStatus(parent, 'loading')
    if (state.status === 'error') return pushStatus(parent, 'error', state.code)

    const children = sortedChildren(state.items, showHidden)
    if (children.length === 0) return pushStatus(parent, 'empty')
    for (const item of children) {
      const path = relPath === '' ? item.name : `${relPath}/${item.name}`
      const kind = fsKind(item)
      const id = `fs:${parent.entryId}:${path}`
      const expandable = isContainer(kind)
      const node: TreeNode = {
        id,
        parentId: parent.id,
        depth: parent.depth + 1,
        label: item.name,
        kind,
        source: 'fs',
        entryId: parent.entryId,
        uri: item.uri,
        expandable,
        expanded: expandable && expanded.has(id)
      }
      out.push(node)
      if (node.expanded) visitDirectory(node, path)
    }
  }

  const visitEntries = (
    parentId: string | null,
    parentNodeId: string | null,
    depth: number
  ): void => {
    for (const e of childrenOf.get(parentId) ?? []) {
      const id = `entry:${e.id}`
      const expandable = e.kind !== 'file'
      const node: TreeNode = {
        id,
        parentId: parentNodeId,
        depth,
        label: e.label,
        kind: e.kind,
        source: 'entry',
        entryId: e.id,
        uri: e.uri,
        expandable,
        expanded: expandable && expanded.has(id)
      }
      out.push(node)
      if (!node.expanded) continue
      if (e.kind === 'folder') visitDirectory(node, '')
      else if (childrenOf.has(e.id)) visitEntries(e.id, id, depth + 1)
      // 展开的空分组也给出「空」提示，避免看起来像没有反应
      else pushStatus(node, 'empty')
    }
  }

  visitEntries(null, null, 0)
  return out
}

/** 需要列出与监听的目录：所有可见、已展开且可展开的节点的 URI（去重） */
export function requiredDirectoryUris(input: TreeInput): string[] {
  const uris = new Set<string>()
  for (const n of buildVisibleNodes(input)) {
    if (n.expanded && n.uri !== null && n.status === undefined) uris.add(n.uri)
  }
  return [...uris]
}

/**
 * 求出需要列出的全部目录：子目录的 URI 来自父目录的列表，因此反复用「已能查到的列表」展开，
 * 直到不再出现新的已列出目录（不动点）。lookup 返回 undefined 表示尚未列出（仍然需要，状态为加载中）。
 * 组件在一次渲染内求出所有层级，不必每发现一层就重新渲染一次。
 */
export function resolveDirectoryUris(
  input: Omit<TreeInput, 'directories'>,
  lookup: (uri: string) => DirectoryState | undefined
): string[] {
  const directories = new Map<string, DirectoryState>()
  const looked = new Set<string>()
  for (;;) {
    const uris = requiredDirectoryUris({ ...input, directories })
    let grew = false
    for (const uri of uris) {
      if (looked.has(uri)) continue
      looked.add(uri)
      const state = lookup(uri)
      if (state?.status === 'ready') {
        directories.set(uri, state)
        grew = true
      }
    }
    if (!grew) return uris
  }
}
