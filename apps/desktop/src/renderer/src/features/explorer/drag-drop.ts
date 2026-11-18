import type { NodeKind, TreeNode } from './tree-model'

/**
 * 资源树的拖放只管理「工作区条目」：排序、移入分组、把真实子目录 / 系统文件固定为条目。
 * 这里只做纯计算（拖到哪里 → 要执行什么条目操作）；任何结果都不涉及磁盘上的文件。
 */

/** 拖动时写入 dataTransfer 的自定义 MIME。不设置 text/uri-list、text/plain、DownloadURL，拖出应用不会产生文件 */
export const DRAG_MIME = 'application/x-pch-node'

export type DragSource =
  { type: 'entry'; entryId: string } | { type: 'fs'; uri: string } | { type: 'os'; paths: string[] }

export type DropPosition = 'before' | 'after' | 'inside'

export type DropAction =
  | { type: 'move'; entryId: string; parentId: string | null; index: number }
  | { type: 'add'; parentId: string | null; items: Array<{ path: string } | { uri: string }> }

/** 「追加到末尾」的 index（主进程会按兄弟数量截断；折叠分组的子项数未知时使用） */
const END = Number.MAX_SAFE_INTEGER

/** 状态行（加载中 / 出错 / 空）：id 以 `#status` 结尾，kind / uri 沿用父节点，不能拖动也不能放置 */
export function isStatusNode(node: TreeNode): boolean {
  return node.status !== undefined && node.id.endsWith('#status')
}

/** 该节点能否作为拖动来源：条目与真实子项可以；状态行与失效链接不可 */
export function isDraggableNode(node: TreeNode): boolean {
  return !isStatusNode(node) && node.kind !== 'link-broken'
}

/**
 * 把真实子项「固定」为条目时的条目类型。主进程 stat 跟随符号链接 / 目录联接，
 * 所以链接按目标类型（link-directory → folder）添加即可通过类型校验。
 */
export function fsEntryKind(kind: NodeKind): 'folder' | 'file' {
  return kind === 'directory' || kind === 'link-directory' ? 'folder' : 'file'
}

/** 由行内纵向位置求落点：上 25% 为 before、下 25% 为 after、中间为 inside（仅分组） */
export function positionFromOffset(
  offsetY: number,
  height: number,
  canInside: boolean
): DropPosition {
  const ratio = height > 0 ? offsetY / height : 0.5
  if (canInside) {
    if (ratio < 0.25) return 'before'
    if (ratio > 0.75) return 'after'
    return 'inside'
  }
  return ratio < 0.5 ? 'before' : 'after'
}

/**
 * 求落点对应的条目操作。
 * target 为 null 表示树的空白处（= 根末尾）。以下情况返回 null（不接受放置）：
 * 目标是真实节点或状态行；inside 的目标不是分组；条目拖到自身或自己的后代之上。
 * 'add' 总是追加到父节点末尾（entry.add 没有 index 参数），落点位置只决定父节点。
 */
export function resolveDrop(
  source: DragSource,
  target: TreeNode | null,
  position: DropPosition,
  nodes: TreeNode[]
): DropAction | null {
  if (target !== null) {
    if (isStatusNode(target) || target.source !== 'entry') return null
    if (position === 'inside' && target.kind !== 'group') return null
  }

  // 展开且有可见子项的分组，下缘的线画在分组与第一个子项之间（与「第一个子项之前」同一条线），
  // 因此按进入分组第 0 位处理；折叠或空分组（只有状态行）保持「该分组之后」
  let firstChild = false
  if (
    target !== null &&
    position === 'after' &&
    target.kind === 'group' &&
    target.expanded &&
    nodes.some((n) => n.parentId === target.id && !isStatusNode(n))
  ) {
    position = 'inside'
    firstChild = true
  }

  // 落点的父条目：inside 为目标本身，before / after 为目标的父节点，空白处为根
  let parentId: string | null = null
  if (target !== null) {
    if (position === 'inside') parentId = target.entryId
    else if (target.parentId !== null) {
      const parent = nodes.find((n) => n.id === target.parentId)
      if (!parent || parent.source !== 'entry') return null
      parentId = parent.entryId
    }
  }

  if (source.type === 'fs') return { type: 'add', parentId, items: [{ uri: source.uri }] }
  if (source.type === 'os') {
    return { type: 'add', parentId, items: source.paths.map((path) => ({ path })) }
  }

  // 条目移动：目标（含自身）的祖先链上有被拖动的条目 → 拖到自身或后代
  const sourceNodeId = `entry:${source.entryId}`
  const byId = new Map(nodes.map((n) => [n.id, n]))
  for (let n: TreeNode | undefined = target ?? undefined; n;) {
    if (n.id === sourceNodeId) return null
    n = n.parentId === null ? undefined : byId.get(n.parentId)
  }

  // index 基于「移除自身后」的兄弟列表（与主进程 entry.move 的语义一致）
  const parentNodeId = parentId === null ? null : `entry:${parentId}`
  const siblings = nodes.filter(
    (n) => n.source === 'entry' && n.parentId === parentNodeId && n.entryId !== source.entryId
  )
  let index: number
  if (target === null) index = siblings.length
  else if (position === 'inside') index = firstChild ? 0 : END
  else {
    const at = siblings.findIndex((n) => n.id === target.id)
    if (at < 0) return null
    index = position === 'before' ? at : at + 1
  }
  return { type: 'move', entryId: source.entryId, parentId, index }
}

/**
 * 系统文件拖入时的 dropEffect：只用 copy / link，绝不用 move
 * （move 会让资源管理器等来源端把原文件移走）；来源只允许 move 等其他效果时返回 null（不接受）。
 */
export function osDropEffect(effectAllowed: string): 'copy' | 'link' | null {
  const allowed = effectAllowed.toLowerCase()
  if (allowed === 'uninitialized' || allowed === 'all' || allowed.includes('copy')) return 'copy'
  if (allowed.includes('link')) return 'link'
  return null
}
