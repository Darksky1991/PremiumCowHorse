import { useId, useMemo, useRef, useState, type JSX, type KeyboardEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { FileEntry, WorkspaceEntry } from '@pch/shared'
import { useSetting } from '@renderer/data/settings'
import { useDirectories, useWatchDirectories, type DirectoryState } from '@renderer/data/vfs'
import { queryKeys } from '@renderer/lib/query-keys'
import { useExplorerStore } from './explorer-store'
import { buildVisibleNodes, resolveDirectoryUris, type TreeNode } from './tree-model'
import { TreeRow } from './tree-row'

const NO_IDS: string[] = []
/** 默认密度下的行高；实际高度由 measureElement 测量（紧凑密度下随 --spacing 变小） */
const ROW_ESTIMATE = 28

export interface ExplorerTreeProps {
  workspaceId: string
  entries: WorkspaceEntry[]
  /** tree 的无障碍名称 */
  label: string
  /** 状态行的「重试」：让该目录重新获取 */
  onRetry: (uri: string) => void
}

/**
 * 工作区条目 + 懒加载真实目录的虚拟化树。
 * 展开状态 → 需要的目录 → 列表结果 → 拍平的节点；只渲染可见范围内的行。
 */
export function ExplorerTree({
  workspaceId,
  entries,
  label,
  onRetry
}: ExplorerTreeProps): JSX.Element {
  const baseId = useId()
  const scrollRef = useRef<HTMLDivElement>(null)
  const showHidden = useSetting('explorer.showHiddenFiles') ?? false
  const expandedIds = useExplorerStore((s) => s.expanded[workspaceId] ?? NO_IDS)
  const selectedId = useExplorerStore((s) => s.selected[workspaceId] ?? null)
  const toggle = useExplorerStore((s) => s.toggle)
  const select = useExplorerStore((s) => s.select)
  const expanded = useMemo(() => new Set(expandedIds), [expandedIds])

  // 需要列出的目录依赖父目录的列表（子目录的 URI 来自父目录的列表）。
  // 查询集合存为 state，变化时在渲染中同步（React 推荐的「根据渲染结果调整 state」写法）；
  // 求集合时同时查 TanStack Query 缓存，已缓存的多层目录一次求出，不会每层多渲染一次。
  const queryClient = useQueryClient()
  const [uris, setUris] = useState<string[]>([])
  const directories = useStableDirectories(useDirectories(uris))
  useWatchDirectories(uris)

  const nodes = useMemo(
    () => buildVisibleNodes({ entries, expanded, directories, showHidden }),
    [entries, expanded, directories, showHidden]
  )
  const required = useMemo(
    () =>
      resolveDirectoryUris({ entries, expanded, showHidden }, (uri) => {
        const known = directories.get(uri)
        if (known) return known
        const items = queryClient.getQueryData<FileEntry[]>(queryKeys.directory(uri))
        return items ? { status: 'ready', items } : undefined
      }),
    [entries, expanded, showHidden, directories, queryClient]
  )
  if (!sameList(required, uris)) setUris(required)

  const indexById = useMemo(() => new Map(nodes.map((n, i) => [n.id, i])), [nodes])
  const selectedIndex = selectedId === null ? -1 : (indexById.get(selectedId) ?? -1)

  // 本项目未启用 React Compiler；该规则只提示「编译器会跳过此组件」，不影响运行
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: nodes.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_ESTIMATE,
    getItemKey: (i) => nodes[i]?.id ?? i,
    overscan: 10
  })
  const items = virtualizer.getVirtualItems()

  const moveTo = (index: number): void => {
    const i = Math.max(0, Math.min(nodes.length - 1, index))
    const node = nodes[i]
    if (!node) return
    select(workspaceId, node.id)
    virtualizer.scrollToIndex(i, { align: 'auto' })
  }

  /** 折叠时若选中项在其子孙中，选择移到被折叠的节点上（否则选中项不可见，键盘无从继续） */
  const toggleNode = (node: TreeNode): void => {
    if (
      node.expanded &&
      selectedId !== null &&
      isDescendant(selectedId, node.id, nodes, indexById)
    ) {
      select(workspaceId, node.id)
    }
    toggle(workspaceId, node.id)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return
    const current = nodes[selectedIndex]
    switch (e.key) {
      case 'ArrowDown':
        moveTo(current ? selectedIndex + 1 : 0)
        break
      case 'ArrowUp':
        moveTo(current ? selectedIndex - 1 : 0)
        break
      case 'ArrowRight':
        if (!current) moveTo(0)
        else if (current.expandable && !current.expanded) toggleNode(current)
        else if (current.expanded && nodes[selectedIndex + 1]?.parentId === current.id) {
          moveTo(selectedIndex + 1)
        }
        break
      case 'ArrowLeft':
        if (!current) moveTo(0)
        else if (current.expanded) toggleNode(current)
        else if (current.parentId !== null) moveTo(indexById.get(current.parentId) ?? 0)
        break
      case 'Enter':
        if (current?.expandable) toggleNode(current)
        else if (current?.status === 'error' && current.uri !== null) onRetry(current.uri)
        break
      default:
        return
    }
    e.preventDefault()
  }

  const rowDomId = (index: number): string => `${baseId}-row-${index}`
  const selectedRendered = items.some((v) => v.index === selectedIndex)

  return (
    <div
      ref={scrollRef}
      role="tree"
      aria-label={label}
      aria-activedescendant={selectedRendered ? rowDomId(selectedIndex) : undefined}
      tabIndex={0}
      onKeyDown={onKeyDown}
      className="group/tree h-full overflow-auto outline-none"
    >
      <div
        role="presentation"
        className="relative w-full"
        style={{ height: virtualizer.getTotalSize() }}
      >
        {items.map((v) => {
          const node = nodes[v.index]
          if (!node) return null
          return (
            <TreeRow
              key={v.key}
              ref={virtualizer.measureElement}
              node={node}
              domId={rowDomId(v.index)}
              index={v.index}
              selected={v.index === selectedIndex}
              style={{ transform: `translateY(${v.start}px)` }}
              onClick={() => {
                select(workspaceId, node.id)
                if (node.expandable) toggleNode(node)
              }}
              onRetry={() => {
                if (node.uri !== null) onRetry(node.uri)
              }}
            />
          )
        })}
      </div>
    </div>
  )
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i])
}

function sameState(a: DirectoryState, b: DirectoryState): boolean {
  if (a.status === 'ready') return b.status === 'ready' && a.items === b.items
  if (a.status === 'error') return b.status === 'error' && a.code === b.code
  return b.status === a.status
}

/**
 * useDirectories 每次渲染都返回新的 Map；内容不变时沿用上一次的 Map，
 * 让拍平计算的 useMemo 只在列表真正变化时重算（列表数组由 TanStack Query 保持引用稳定）。
 */
function useStableDirectories(
  next: Map<string, DirectoryState>
): ReadonlyMap<string, DirectoryState> {
  const [stable, setStable] = useState(next)
  const same =
    stable.size === next.size &&
    [...next].every(([uri, state]) => {
      const prev = stable.get(uri)
      return prev !== undefined && sameState(prev, state)
    })
  if (same) return stable
  setStable(next)
  return next
}

function isDescendant(
  id: string,
  ancestorId: string,
  nodes: readonly TreeNode[],
  indexById: ReadonlyMap<string, number>
): boolean {
  let index = indexById.get(id)
  while (index !== undefined) {
    const parentId = nodes[index]?.parentId ?? null
    if (parentId === null) return false
    if (parentId === ancestorId) return true
    index = indexById.get(parentId)
  }
  return false
}
