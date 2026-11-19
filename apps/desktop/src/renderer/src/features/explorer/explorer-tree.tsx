import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type JSX,
  type KeyboardEvent,
  type MouseEvent
} from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useReachabilityStore } from '@renderer/stores/reachability-store'
import { useTabsStore } from '@renderer/stores/tabs-store'
import { useVirtualizer } from '@tanstack/react-virtual'
import { toast } from 'sonner'
import { AppError, type DirectoryListing, type WorkspaceEntry } from '@pch/shared'
import { ContextMenu, ContextMenuTrigger } from '@pch/ui/components/context-menu'
import { useSetting } from '@renderer/data/settings'
import { useDirectories, useVfsInterest, type DirectoryState } from '@renderer/data/vfs'
import { call, getBridge } from '@renderer/lib/ipc'
import { queryKeys } from '@renderer/lib/query-keys'
import {
  DRAG_MIME,
  isDraggableNode,
  osDropEffect,
  positionFromOffset,
  isStatusNode,
  resolveDrop,
  type DragSource,
  type DropPosition
} from './drag-drop'
import { useExplorerStore } from './explorer-store'
import { interestFromTree } from './interest'
import { isEntryNode } from './menu-items'
import { NewGroupDialog } from './new-group-dialog'
import { NodeContextMenu } from './node-context-menu'
import { openTarget } from './open-target'
import { RemoveEntryDialog, type RemoveTarget } from './remove-entry-dialog'
import { RenameDialog, type RenameTarget } from './rename-dialog'
import { hiddenSelectionIndex, resolveSelection } from './selection'
import { useDropExecutor } from './use-drop-executor'
import { buildVisibleNodes, drawerIds, resolveDirectoryUris, type TreeNode } from './tree-model'
import { TreeRow } from './tree-row'
import { useRevealRequests } from './use-reveal'

const NO_IDS: string[] = []

/** 当前悬停的落点（nodeId 为 null 表示树的空白处） */
interface DropTarget {
  nodeId: string | null
  position: DropPosition
}
/** 当前打开的对话框（关闭后保留内容，让关闭动画期间对话框不会变空） */
type DialogState =
  | { type: 'rename'; target: RenameTarget }
  | { type: 'remove'; target: RemoveTarget }
  | { type: 'newGroup'; parentId: string | null }

/** 默认密度下的行高；实际高度由 measureElement 测量（紧凑密度下随 --spacing 变小） */
const ROW_ESTIMATE = 28
/** 键盘移动选中后，停留这么久才在当前标签打开（设计 2.8：快速连按只在停留处打开一次、记一条历史） */
const KEY_OPEN_DELAY_MS = 400

export interface ExplorerTreeProps {
  workspaceId: string
  entries: WorkspaceEntry[]
  /** tree 的无障碍名称 */
  label: string
  /** 状态行的「重试」：让扫描进程立即检查该目录并重新获取 */
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
  const { t } = useTranslation()
  const scrollRef = useRef<HTMLDivElement>(null)
  const showHidden = useSetting('explorer.showHiddenFiles') ?? false
  // 键名沿用 M1-3（避免迁移）；含义为「单击 / 键盘移动选中即在当前标签打开」，关闭时只选中、Enter 打开
  const selectionOpens = useSetting('explorer.singleClickPreview') ?? true
  const openHere = useTabsStore((s) => s.openHere)
  const expandedIds = useExplorerStore((s) => s.expanded[workspaceId] ?? NO_IDS)
  const selectedId = useExplorerStore((s) => s.selected[workspaceId] ?? null)
  const toggle = useExplorerStore((s) => s.toggle)
  const select = useExplorerStore((s) => s.select)
  const expanded = useMemo(() => new Set(expandedIds), [expandedIds])
  // 分组抽屉：根下的分组同一时刻只展开一个（设计 2.7）
  const drawers = useMemo(() => drawerIds(entries), [entries])
  const offlineShares = useReachabilityStore((s) => s.offlineShares)

  // 需要列出的目录依赖父目录的列表（子目录的 URI 来自父目录的列表）。
  // 查询集合存为 state，变化时在渲染中同步（React 推荐的「根据渲染结果调整 state」写法）；
  // 求集合时同时查 TanStack Query 缓存，已缓存的多层目录一次求出，不会每层多渲染一次。
  const queryClient = useQueryClient()
  const [uris, setUris] = useState<string[]>([])
  const directories = useStableDirectories(useDirectories(uris))

  const nodes = useMemo(
    () => buildVisibleNodes({ entries, expanded, directories, showHidden, offlineShares }),
    [entries, expanded, directories, showHidden, offlineShares]
  )
  const required = useMemo(
    () =>
      resolveDirectoryUris({ entries, expanded, showHidden }, (uri) => {
        const known = directories.get(uri)
        if (known) return known
        const data = queryClient.getQueryData<DirectoryListing>(queryKeys.directory(uri))
        return data
          ? { status: 'ready', items: data.items, state: data.state, checkedAt: data.checkedAt }
          : undefined
      }),
    [entries, expanded, showHidden, directories, queryClient]
  )
  if (!sameList(required, uris)) setUris(required)

  const indexById = useMemo(() => new Map(nodes.map((n, i) => [n.id, i])), [nodes])
  // 选中的节点消失（状态行被子项取代、节点被删除）时回退，上一次的位置存为 state；
  // 回退后的节点在 effect 中写回 store，之后的键盘操作都以它为起点
  const [lastIndex, setLastIndex] = useState(-1)
  // 选中项被折叠的祖先挡住（抽屉互斥、全部折叠）时显示为该祖先选中，但不写回 store：
  // 重新展开后原来的选中项恢复（Review Focus 5）
  const hiddenIndex = useMemo(
    () => hiddenSelectionIndex(nodes, entries, selectedId),
    [nodes, entries, selectedId]
  )
  const selectedIndex =
    hiddenIndex >= 0 ? hiddenIndex : resolveSelection(nodes, selectedId, lastIndex)
  if (selectedIndex !== lastIndex) setLastIndex(selectedIndex)
  const resolvedId = nodes[selectedIndex]?.id ?? null
  const selectionHidden = hiddenIndex >= 0
  useEffect(() => {
    if (selectionHidden) return
    if (resolvedId !== null && resolvedId !== selectedId) select(workspaceId, resolvedId)
  }, [resolvedId, selectedId, select, workspaceId, selectionHidden])

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

  // ---------- 打开：浏览器式（设计 2.8）——当前标签内导航 / 新标签 ----------
  /** ↑↓ 等键盘移动后的防抖打开（尚未触发时为计时器） */
  const keyOpenTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const cancelKeyOpen = (): void => clearTimeout(keyOpenTimer.current)
  useEffect(() => () => clearTimeout(keyOpenTimer.current), [])

  /**
   * 打开节点（分组、状态行、失效链接不打开）：在当前标签打开（进入历史；没有标签时新建），
   * newTab 时在新标签打开（同 URI 已打开则只激活）。取消尚未触发的键盘防抖打开
   */
  const openNode = (node: TreeNode, newTab = false): void => {
    cancelKeyOpen()
    const target = openTarget(node)
    if (target) openHere(workspaceId, target, { newTab })
  }

  // 定位请求：搜索结果的「在树中定位」（locate：选中、居中滚动、焦点移到树上）与
  // 激活标签位置变化后的同步（sync：只选中并滚动到可见，不聚焦）。
  // 这里的选中不打开任何东西（打开只由用户的单击 / 键盘 / 菜单发起），同步不会形成循环
  useRevealRequests({
    workspaceId,
    entries,
    nodes,
    // 选中项被折叠挡住时，显示为选中的祖先不是真正的选中（同步不能据此跳过）
    selectedUri: selectionHidden ? null : (nodes[selectedIndex]?.uri ?? null),
    drawers,
    reveal: (index, mode) => {
      const node = nodes[index]
      if (!node) return
      select(workspaceId, node.id)
      virtualizer.scrollToIndex(index, { align: mode === 'locate' ? 'center' : 'auto' })
      if (mode === 'locate') scrollRef.current?.focus()
    },
    // 标签的位置被其他操作改变（地址栏、后退、切换标签…）：之前 ↑↓ 停留处的打开作废
    onRequest: cancelKeyOpen
  })

  // 告诉扫描进程本窗口的关注点（选中节点所在的目录）与视口内外的已展开目录（300ms 防抖）
  const rangeStart = items[0]?.index ?? -1
  const rangeEnd = items.at(-1)?.index ?? -1
  const interest = useMemo(
    () =>
      interestFromTree(
        nodes,
        rangeStart < 0 ? null : { start: rangeStart, end: rangeEnd },
        resolvedId
      ),
    [nodes, rangeStart, rangeEnd, resolvedId]
  )
  useVfsInterest(interest)

  // ---------- 拖放：只管理条目，绝不产生文件操作 ----------
  const execute = useDropExecutor(workspaceId)
  // 条目 / 真实子项的拖动来源（dragover 阶段读不到 dataTransfer 的数据，只能保存在这里）
  const dragSourceRef = useRef<DragSource | null>(null)
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null)

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
      const effect = osDropEffect(e.dataTransfer.effectAllowed)
      if (effect === null) {
        setDropTarget(null)
        return
      }
      e.dataTransfer.dropEffect = effect
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
    if (action) void execute(action, nodes)
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

  // ---------- 右键菜单与条目操作：只管理条目，绝不产生文件操作 ----------
  /** 右键的节点（null 为空白处）；菜单内容据此生成 */
  const [menuNode, setMenuNode] = useState<TreeNode | null>(null)
  const [dialog, setDialog] = useState<DialogState | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const openDialog = (next: DialogState): void => {
    setDialog(next)
    setDialogOpen(true)
  }

  const onContextMenu = (
    e: MouseEvent<HTMLDivElement> & { preventBaseUIHandler?: () => void }
  ): void => {
    const row = (e.target as HTMLElement).closest<HTMLElement>('[data-index]')
    const node = row ? (nodes[Number(row.dataset.index)] ?? null) : null
    if (node !== null && isStatusNode(node)) {
      // 状态行没有菜单：交由浏览器默认行为（Electron 中不显示任何东西）
      e.preventBaseUIHandler?.()
      return
    }
    setMenuNode(node)
    // 与 VS Code 一致：右键同时选中该节点
    if (node !== null) select(workspaceId, node.id)
  }

  const openRename = (node: TreeNode): void =>
    openDialog({ type: 'rename', target: { entryId: node.entryId, label: node.label } })
  const openRemove = (node: TreeNode): void =>
    openDialog({
      type: 'remove',
      target: { entryId: node.entryId, label: node.label, isGroup: node.kind === 'group' }
    })
  const openNewGroup = (node: TreeNode | null): void => {
    // 在折叠的分组下新建时先展开，新分组才看得见
    if (node !== null && !node.expanded) toggle(workspaceId, node.id, drawers)
    openDialog({ type: 'newGroup', parentId: node?.entryId ?? null })
  }

  /** 用系统对话框选择文件夹 / 文件并添加为根部条目（复用拖放的添加逻辑） */
  const addPaths = async (kind: 'folder' | 'file'): Promise<void> => {
    try {
      const paths = await call('system.selectPaths', { kind, multiple: true })
      if (paths.length === 0) return
      await execute({ type: 'add', parentId: null, items: paths.map((path) => ({ path })) }, nodes)
    } catch (e) {
      toast.error(t(`errors:${e instanceof AppError ? e.code : 'UNKNOWN'}`))
    }
  }

  /** 把真实子项固定为工作区根部的条目 */
  const pin = (node: TreeNode): void => {
    if (node.uri === null) return
    void execute({ type: 'add', parentId: null, items: [{ uri: node.uri }] }, nodes)
  }

  /** 键盘移动选中；停留 KEY_OPEN_DELAY_MS 后在当前标签打开（快速连按只打开最后停留处） */
  const moveTo = (index: number): void => {
    const i = Math.max(0, Math.min(nodes.length - 1, index))
    const node = nodes[i]
    if (!node) return
    select(workspaceId, node.id)
    virtualizer.scrollToIndex(i, { align: 'auto' })
    cancelKeyOpen()
    if (selectionOpens && openTarget(node) !== null) {
      keyOpenTimer.current = setTimeout(() => openNode(node), KEY_OPEN_DELAY_MS)
    }
  }

  /**
   * 折叠时若选中项在其子孙中，选择移到被折叠的节点上（否则选中项不可见，键盘无从继续）。
   * 抽屉（顶层分组）例外：选中不改写，显示为该分组选中，重新展开后恢复（与互斥收起时相同）
   */
  const toggleNode = (node: TreeNode): void => {
    if (
      node.expanded &&
      !drawers.includes(node.id) &&
      resolvedId !== null &&
      isDescendant(resolvedId, node.id, nodes, indexById)
    ) {
      select(workspaceId, node.id)
    }
    toggle(workspaceId, node.id, drawers)
  }

  /**
   * 单击：选中，并按设置在当前标签打开；Ctrl+单击：在新标签打开。目录单击不展开（需求 7）。
   * 双击时的第二次单击（detail 为 2）不再处理，交给 onRowDoubleClick
   */
  const onRowClick = (e: MouseEvent<HTMLDivElement>, node: TreeNode): void => {
    if (e.detail >= 2) return
    // 抽屉的标题：单击 = 展开 / 收起（与箭头相同），不改变选中（被收起分组内的选中项保留）
    if (drawers.includes(node.id)) return toggleNode(node)
    select(workspaceId, node.id)
    if (e.ctrlKey || e.metaKey) openNode(node, true)
    else if (selectionOpens) openNode(node)
    else cancelKeyOpen()
  }

  /**
   * 双击：可展开的节点（分组、目录）展开 / 折叠；文件与单击相同（不另开标签）——第一次单击已经打开，
   * 只有设置关闭（单击只选中）时才在这里打开
   */
  const onRowDoubleClick = (node: TreeNode): void => {
    // 抽屉的标题由单击切换；双击的第二次不再切换回去
    if (drawers.includes(node.id)) return
    if (node.expandable) toggleNode(node)
    else if (!selectionOpens) openNode(node)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    // 只处理树本身获得焦点时的按键：行内控件（「重试」按钮）上的 Enter / ↑↓ 交给控件自己
    if (e.target !== e.currentTarget) return
    const current = nodes[selectedIndex]
    // Ctrl+Enter：在新标签打开
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey) {
      if (current) openNode(current, true)
      e.preventDefault()
      return
    }
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return
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
        // Enter：可展开的节点展开 / 折叠，并立即在当前标签打开（不等防抖）；错误行为重试
        if (current?.status === 'error' && current.uri !== null) onRetry(current.uri)
        else if (current) {
          if (current.expandable) toggleNode(current)
          openNode(current)
        }
        break
      case 'F2':
        if (!isEntryNode(current)) return
        openRename(current)
        break
      case 'Delete':
        if (!isEntryNode(current)) return
        openRemove(current)
        break
      default:
        return
    }
    e.preventDefault()
  }

  const rowDomId = (index: number): string => `${baseId}-row-${index}`
  const selectedRendered = items.some((v) => v.index === selectedIndex)

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger onContextMenu={onContextMenu} className="block h-full">
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
                    draggable={
                      isDraggableNode(node) && (node.source === 'entry' || node.uri !== null)
                    }
                    dropPosition={dropTarget?.nodeId === node.id ? dropTarget.position : null}
                    onDragStart={(e) => onNodeDragStart(e, node)}
                    onDragEnd={() => {
                      dragSourceRef.current = null
                      setDropTarget(null)
                    }}
                    style={{ transform: `translateY(${v.start}px)` }}
                    onClick={(e) => onRowClick(e, node)}
                    onDoubleClick={() => onRowDoubleClick(node)}
                    onMiddleClick={() => openNode(node, true)}
                    onToggle={() => toggleNode(node)}
                    onRetry={() => {
                      if (node.uri !== null) onRetry(node.uri)
                    }}
                  />
                )
              })}
            </div>
          </div>
        </ContextMenuTrigger>
        <NodeContextMenu
          workspaceId={workspaceId}
          node={menuNode}
          finalFocus={scrollRef}
          onOpenInNewTab={() => menuNode && openNode(menuNode, true)}
          onNewGroup={() => openNewGroup(menuNode)}
          onAddPaths={(kind) => void addPaths(kind)}
          onRename={() => menuNode && openRename(menuNode)}
          onRemove={() => menuNode && openRemove(menuNode)}
          onPin={() => menuNode && pin(menuNode)}
        />
      </ContextMenu>
      {dialog?.type === 'rename' && (
        <RenameDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          target={dialog.target}
          finalFocus={scrollRef}
        />
      )}
      {dialog?.type === 'remove' && (
        <RemoveEntryDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          target={dialog.target}
          finalFocus={scrollRef}
        />
      )}
      {dialog?.type === 'newGroup' && (
        <NewGroupDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          workspaceId={workspaceId}
          parentId={dialog.parentId}
          finalFocus={scrollRef}
        />
      )}
    </>
  )
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i])
}

function sameState(a: DirectoryState, b: DirectoryState): boolean {
  if (a.status === 'ready') {
    return (
      b.status === 'ready' &&
      a.items === b.items &&
      a.state === b.state &&
      a.checkedAt === b.checkedAt
    )
  }
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
