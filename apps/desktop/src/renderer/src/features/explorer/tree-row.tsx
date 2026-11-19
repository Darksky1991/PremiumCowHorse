import type { CSSProperties, DragEvent, JSX, MouseEvent, Ref } from 'react'
import {
  ChevronRightIcon,
  CircleAlertIcon,
  FileIcon,
  FileSymlinkIcon,
  FileXIcon,
  FolderIcon,
  FolderOpenIcon,
  FolderRootIcon,
  FolderSymlinkIcon,
  LayersIcon,
  UnplugIcon,
  type LucideIcon
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from 'cn'
import { Button } from '@pch/ui/components/button'
import { Spinner } from '@pch/ui/components/spinner'
import type { DropPosition } from './drag-drop'
import type { NodeKind, TreeNode } from './tree-model'

const ICONS: Record<NodeKind, LucideIcon> = {
  group: LayersIcon,
  folder: FolderRootIcon,
  file: FileIcon,
  directory: FolderIcon,
  'link-directory': FolderSymlinkIcon,
  'link-file': FileSymlinkIcon,
  'link-broken': FileXIcon
}

export interface TreeRowProps {
  node: TreeNode
  /** DOM id（供 tree 的 aria-activedescendant 引用） */
  domId: string
  /** 虚拟滚动的行序号（measureElement 据此对应测量结果） */
  index: number
  selected: boolean
  style: CSSProperties
  ref: Ref<HTMLDivElement>
  /** 可作为拖动来源（状态行与失效链接不可） */
  draggable: boolean
  /** 拖动悬停在本行时的落点；null 表示没有 */
  dropPosition: DropPosition | null
  onDragStart: (e: DragEvent<HTMLDivElement>) => void
  onDragEnd: () => void
  /** 单击（双击时的第二次单击 e.detail 为 2） */
  onClick: (e: MouseEvent<HTMLDivElement>) => void
  onDoubleClick: () => void
  /** 中键单击（auxclick）：在新标签打开 */
  onMiddleClick: () => void
  /** 展开箭头的单击：只展开 / 折叠（不选中、不打开） */
  onToggle: () => void
  onRetry: () => void
}

/** 落点高亮：before / after 为行上 / 下边线，inside（放进分组）为背景高亮；颜色用设计 token */
const DROP_STYLES: Record<DropPosition, string> = {
  before: 'shadow-[inset_0_2px_0_0_var(--sidebar-ring)]',
  after: 'shadow-[inset_0_-2px_0_0_var(--sidebar-ring)]',
  inside: 'bg-sidebar-accent outline outline-1 -outline-offset-1 outline-sidebar-ring'
}

/** 资源树的一行：缩进 + 展开箭头 + 图标 + 名称；状态行显示加载 / 错误（含「重试」）/ 空 */
export function TreeRow({
  node,
  domId,
  index,
  selected,
  style,
  ref,
  draggable,
  dropPosition,
  onDragStart,
  onDragEnd,
  onClick,
  onDoubleClick,
  onMiddleClick,
  onToggle,
  onRetry
}: TreeRowProps): JSX.Element {
  const { t, i18n } = useTranslation()
  const Icon = node.kind === 'directory' && node.expanded ? FolderOpenIcon : ICONS[node.kind]

  return (
    <div
      ref={ref}
      id={domId}
      role="treeitem"
      aria-level={node.depth + 1}
      aria-expanded={node.expandable ? node.expanded : undefined}
      aria-selected={selected}
      data-index={index}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      // 中键：按下时阻止自动滚动，auxclick 时在新标签打开
      onMouseDown={(e) => {
        if (e.button === 1) e.preventDefault()
      }}
      onAuxClick={(e) => {
        if (e.button !== 1) return
        e.preventDefault()
        onMiddleClick()
      }}
      style={{
        ...style,
        // 每级缩进 4 个间距单位（默认 16px），紧凑密度下随 --spacing 缩小
        paddingLeft: `calc(var(--spacing) * ${2 + node.depth * 4})`
      }}
      className={cn(
        'absolute top-0 left-0 flex h-7 w-full cursor-default items-center gap-1 pr-2 text-[13px] select-none',
        selected
          ? 'bg-sidebar-accent text-sidebar-accent-foreground group-focus/tree:outline group-focus/tree:-outline-offset-1 group-focus/tree:outline-sidebar-ring'
          : 'hover:bg-sidebar-accent/50',
        dropPosition !== null && DROP_STYLES[dropPosition]
      )}
    >
      {node.status ? (
        <StatusContent node={node} onRetry={onRetry} />
      ) : (
        <>
          <ChevronRightIcon
            aria-hidden
            data-tree-toggle=""
            // 箭头只展开 / 折叠：不冒泡到行（不选中、不打开）；快速连点时第二次单击与双击都不再切换
            onClick={(e) => {
              e.stopPropagation()
              if (node.expandable && e.detail < 2) onToggle()
            }}
            onDoubleClick={(e) => e.stopPropagation()}
            className={cn(
              'size-4 shrink-0 text-muted-foreground transition-transform',
              !node.expandable && 'invisible',
              node.expanded && 'rotate-90'
            )}
          />
          <Icon
            aria-hidden
            className={cn(
              'size-4 shrink-0 text-muted-foreground',
              node.kind === 'link-broken' && 'text-destructive'
            )}
          />
          <span
            className={cn('min-w-0 truncate', node.dimmed && 'text-muted-foreground')}
            title={rowTitle(
              node,
              t('explorer:lastUpdated', { time: formatTime(node, i18n.language) })
            )}
          >
            {node.label}
          </span>
          {node.offline ? (
            <UnplugIcon
              role="img"
              aria-label={t('explorer:disconnected')}
              className="ml-auto size-4 shrink-0 text-muted-foreground"
            />
          ) : null}
        </>
      )}
    </div>
  )
}

/** 显示缓存内容的目录（cached / offline）：悬停显示上次检查的时刻；其余行只显示名称 */
function rowTitle(node: TreeNode, lastUpdated: string): string {
  return node.checkedAt === undefined || node.checkedAt === null
    ? node.label
    : `${node.label}\n${lastUpdated}`
}

function formatTime(node: TreeNode, language: string): string {
  return node.checkedAt == null ? '' : new Date(node.checkedAt).toLocaleString(language)
}

function StatusContent({ node, onRetry }: { node: TreeNode; onRetry: () => void }): JSX.Element {
  const { t } = useTranslation()
  // 状态行与同级子项的名称对齐（越过箭头的位置）
  const lead = <span aria-hidden className="size-4 shrink-0" />

  if (node.status === 'loading') {
    return (
      <>
        {lead}
        <Spinner aria-hidden className="text-muted-foreground" />
        <span className="truncate text-muted-foreground">{t('explorer:loading')}</span>
      </>
    )
  }
  if (node.status === 'error') {
    const message = t(`errors:${node.errorCode ?? 'UNKNOWN'}`)
    return (
      <>
        {lead}
        <CircleAlertIcon aria-hidden className="size-4 shrink-0 text-destructive" />
        <span className="min-w-0 flex-1 truncate text-destructive" title={message}>
          {message}
        </span>
        <Button
          size="xs"
          variant="ghost"
          className="shrink-0"
          // 树只保留一个 Tab 停靠点（activedescendant 模式）：键盘路径是「选中错误行后按 Enter」；
          // 鼠标按下时不夺取焦点，重试后该行消失也不会丢失树的焦点
          tabIndex={-1}
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => {
            e.stopPropagation()
            onRetry()
          }}
        >
          {t('explorer:retry')}
        </Button>
      </>
    )
  }
  return (
    <>
      {lead}
      <span className="truncate text-muted-foreground italic">{t('explorer:empty')}</span>
    </>
  )
}
