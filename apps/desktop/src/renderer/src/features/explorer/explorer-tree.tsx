import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type JSX,
  type KeyboardEvent
} from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { AppError, type FileEntry, type WorkspaceEntry } from '@pch/shared'
import { useEntryActions } from '@renderer/data/entries'
import { useSetting } from '@renderer/data/settings'
import { useDirectories, useWatchDirectories, type DirectoryState } from '@renderer/data/vfs'
import { getBridge } from '@renderer/lib/ipc'
import { queryKeys } from '@renderer/lib/query-keys'
import {
  DRAG_MIME,
  fsEntryKind,
  isDraggableNode,
  positionFromOffset,
  resolveDrop,
  type DragSource,
  type DropAction,
  type DropPosition
} from './drag-drop'
import { useExplorerStore } from './explorer-store'
import { resolveSelection } from './selection'
import { buildVisibleNodes, resolveDirectoryUris, type TreeNode } from './tree-model'
import { TreeRow } from './tree-row'

const NO_IDS: string[] = []

/** 当前悬停的落点（nodeId 为 null 表示树的空白处） */
interface DropTarget {
  nodeId: string | null
  position: DropPosition
}
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
  // 选中的节点消失（状态行被子项取代、节点被删除）时回退，上一次的位置存为 state；
  // 回退后的节点在 effect 中写回 store，之后的键盘操作都以它为起点
  const [lastIndex, setLastIndex] = useState(-1)
  const selectedIndex = resolveSelection(nodes, selectedId, lastIndex)
  if (selectedIndex !== lastIndex) setLastIndex(selectedIndex)
  const resolvedId = nodes[selectedIndex]?.id ?? null
  useEffect(() => {
    if (resolvedId !== null && resolvedId !== selectedId) select(workspaceId, resolvedId)
  }, [resolvedId, selectedId, select, workspaceId])

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

  // ---------- 拖放：只管理条目，绝不产生文件操作 ----------
  const { t } = useTranslation()
  const entryActions = useEntryActions()
  // 条目 / 真实子项的拖动来源（dragover 阶段读不到 dataTransfer 的数据，只能保存在这里）
  const dragSourceRef = useRef<DragSource | null>(null)
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null)

  const reportError = (e: unknown): void => {
    toast.error(t(`errors:${e instanceof AppError ? e.code : 'UNKNOWN'}`))
  }

  /** 当前拖动的来源：系统文件（types 含 Files）、本树发起的拖动，其余（文本、其他窗口）忽略 */
  const currentSource = (e: DragEvent): DragSource | null => {
    const types = Array.from(e.dataTransfer.types)
    if (types.includes('Files')) return { type: 'os', paths: [] }
    if (types.includes(DRAG_MIME)) return dragSourceRef.current
    return null
  }

  /** 事件位置对应的落点；落点无效（真实节点、状态行、自身后代…）时为 null */
  const locateDrop = (
    e: DragEvent<HTMLDivElement>,
    source: DragSource
  ): { target: DropTarget; node: TreeNode | null; position: DropPosition } | null => {
    const row = (e.target as HTMLElement).closest<HTMLElement>('[data-index]')
    const node = row ? (nodes[Number(row.dataset.index)] ?? null) : null
    let position: DropPosition = 'after'
    if (row && node) {
      const rect = row.getBoundingClientRect()
      position = positionFromOffset(e.clientY - rect.top, rect.height, node.kind === 'group')
    }
    if (resolveDrop(source, node, position, nodes) === null) return null
    return { target: { nodeId: node?.id ?? null, position }, node, position }
  }

  const onDragOver = (e: DragEvent<HTMLDivElement>): void => {
    const source = currentSource(e)
    const hit = source && locateDrop(e, source)
    if (!source || !hit) {
      // 不 preventDefault：浏览器显示禁止光标，也不会触发 drop
      setDropTarget(null)
      return
    }
    if (source.type === 'os') {
      // 系统文件只允许 copy / link，绝不用 move：move 会让资源管理器等来源端把原文件移走
      const allowed = e.dataTransfer.effectAllowed.toLowerCase()
      if (allowed === 'uninitialized' || allowed === 'all' || allowed.includes('copy')) {
        e.dataTransfer.dropEffect = 'copy'
      } else if (allowed.includes('link')) {
        e.dataTransfer.dropEffect = 'link'
      } else {
        setDropTarget(null)
        return
      }
    } else {
      e.dataTransfer.dropEffect = source.type === 'entry' ? 'move' : 'link'
    }
    e.preventDefault()
    setDropTarget((prev) =>
      prev?.nodeId === hit.target.nodeId && prev.position === hit.target.position
        ? prev
        : hit.target
    )
  }

  const onDragLeave = (e: DragEvent<HTMLDivElement>): void => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropTarget(null)
  }

  /** 执行落点对应的条目操作（只调用 entry.add / entry.move，不触碰磁盘文件） */
  const execute = async (action: DropAction): Promise<void> => {
    if (action.type === 'move') {
      try {
        await entryActions.move.mutateAsync({
          id: action.entryId,
          parentId: action.parentId,
          index: action.index
        })
      } catch (e) {
        reportError(e)
      }
      return
    }
    for (const item of action.items) {
      try {
        if ('uri' in item) {
          // 真实子项：类型由节点决定（stat 跟随链接，link-directory 按 folder 添加）
          const node = nodes.find((n) => n.source === 'fs' && n.uri === item.uri)
          await entryActions.add.mutateAsync({
            kind: node ? fsEntryKind(node.kind) : 'folder',
            workspaceId,
            parentId: action.parentId,
            uri: item.uri
          })
        } else {
          // 系统文件的类型未知：先按 folder，类型不符时按 file 重试
          const base = { workspaceId, parentId: action.parentId, path: item.path }
          try {
            await entryActions.add.mutateAsync({ kind: 'folder', ...base })
          } catch (e) {
            if (!(e instanceof AppError && e.code === 'ENTRY_KIND_MISMATCH')) throw e
            await entryActions.add.mutateAsync({ kind: 'file', ...base })
          }
        }
      } catch (e) {
        reportError(e)
      }
    }
  }

  const onDrop = (e: DragEvent<HTMLDivElement>): void => {
    const source = currentSource(e)
    setDropTarget(null)
    if (!source) return
    const hit = locateDrop(e, source)
    if (!hit) return
    e.preventDefault()
    let resolved: DragSource = source
    if (source.type === 'os') {
      const bridge = getBridge()
      const paths = Array.from(e.dataTransfer.files)
        .map((file) => bridge?.getPathForFile(file) ?? '')
        .filter((p) => p !== '')
      if (paths.length === 0) return
      resolved = { type: 'os', paths }
    }
    const action = resolveDrop(resolved, hit.node, hit.position, nodes)
    if (action) void execute(action)
  }

  const onNodeDragStart = (e: DragEvent<HTMLDivElement>, node: TreeNode): void => {
    const source: DragSource =
      node.source === 'entry'
        ? { type: 'entry', entryId: node.entryId }
        : { type: 'fs', uri: node.uri ?? '' }
    dragSourceRef.current = source
    // 只设置自定义 MIME：不设置 text/uri-list、text/plain、DownloadURL，
    // 拖出应用（资源管理器 / 桌面）时没有任何目标能接受，不会生成文件
    e.dataTransfer.setData(DRAG_MIME, JSON.stringify(source))
    e.dataTransfer.effectAllowed = source.type === 'entry' ? 'move' : 'link'
  }

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
      resolvedId !== null &&
      isDescendant(resolvedId, node.id, nodes, indexById)
    ) {
      select(workspaceId, node.id)
    }
    toggle(workspaceId, node.id)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    // 只处理树本身获得焦点时的按键：行内控件（「重试」按钮）上的 Enter / ↑↓ 交给控件自己
    if (e.target !== e.currentTarget) return
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
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
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
              draggable={isDraggableNode(node) && (node.source === 'entry' || node.uri !== null)}
              dropPosition={dropTarget?.nodeId === node.id ? dropTarget.position : null}
              onDragStart={(e) => onNodeDragStart(e, node)}
              onDragEnd={() => {
                dragSourceRef.current = null
                setDropTarget(null)
              }}
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
