import type { CSSProperties, JSX, Ref } from 'react'
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
  type LucideIcon
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from 'cn'
import { Button } from '@pch/ui/components/button'
import { Spinner } from '@pch/ui/components/spinner'
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
  onClick: () => void
  onRetry: () => void
}

/** 资源树的一行：缩进 + 展开箭头 + 图标 + 名称；状态行显示加载 / 错误（含「重试」）/ 空 */
export function TreeRow({
  node,
  domId,
  index,
  selected,
  style,
  ref,
  onClick,
  onRetry
}: TreeRowProps): JSX.Element {
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
      onClick={onClick}
      style={{
        ...style,
        // 每级缩进 4 个间距单位（默认 16px），紧凑密度下随 --spacing 缩小
        paddingLeft: `calc(var(--spacing) * ${2 + node.depth * 4})`
      }}
      className={cn(
        'absolute top-0 left-0 flex h-7 w-full cursor-default items-center gap-1 pr-2 text-[13px] select-none',
        selected
          ? 'bg-sidebar-accent text-sidebar-accent-foreground group-focus/tree:outline group-focus/tree:-outline-offset-1 group-focus/tree:outline-sidebar-ring'
          : 'hover:bg-sidebar-accent/50'
      )}
    >
      {node.status ? (
        <StatusContent node={node} onRetry={onRetry} />
      ) : (
        <>
          <ChevronRightIcon
            aria-hidden
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
          <span className="min-w-0 truncate" title={node.label}>
            {node.label}
          </span>
        </>
      )}
    </div>
  )
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
