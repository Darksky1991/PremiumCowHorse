import {
  useId,
  useState,
  type JSX,
  type KeyboardEvent,
  type MouseEvent,
  type RefObject
} from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { FileIcon } from '@pch/ui/file-icon'
import { CopyIcon, FolderSearchIcon, LinkIcon, ListTreeIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { notify } from '@renderer/stores/messages-store'
import { cn } from 'cn'
import { AppError, matchRanges, type SearchHit, type SearchTerm } from '@pch/shared'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger
} from '@pch/ui/components/context-menu'
import { call } from '@renderer/lib/ipc'
import { useConnectionNames } from '@renderer/data/connections'
import { copyablePath, displayPath, isLocalUri } from '@renderer/lib/display-path'
import { locationParts } from './format'

/** 默认密度下的行高（两行文字）；实际高度由 measureElement 测量 */
const ROW_ESTIMATE = 44

export interface SearchResultsProps {
  items: SearchHit[]
  terms: SearchTerm[]
  /** 条目 id → 标签（第二行的开头） */
  entryLabels: ReadonlyMap<string, string>
  activeIndex: number
  onActiveChange: (index: number) => void
  onReveal: (hit: SearchHit) => void
  /** Esc：回到搜索框 */
  onEscape: () => void
  listRef: RefObject<HTMLDivElement | null>
  label: string
}

/**
 * 搜索结果的虚拟化列表（listbox + aria-activedescendant，只有一个 Tab 停靠点）。
 * ↑↓ 移动、Enter / 单击在树中定位、Esc 回到搜索框；右键菜单只有只读操作（定位 / 显示 / 复制）。
 */
export function SearchResults({
  items,
  terms,
  entryLabels,
  activeIndex,
  onActiveChange,
  onReveal,
  onEscape,
  listRef,
  label
}: SearchResultsProps): JSX.Element {
  const baseId = useId()
  const { t } = useTranslation()
  const connectionNames = useConnectionNames()
  const [menuHit, setMenuHit] = useState<SearchHit | null>(null)

  // 本项目未启用 React Compiler；该规则只提示「编译器会跳过此组件」，不影响运行
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => ROW_ESTIMATE,
    getItemKey: (i) => items[i]?.uri ?? i,
    overscan: 10
  })
  const rows = virtualizer.getVirtualItems()

  const moveTo = (index: number): void => {
    const i = Math.max(0, Math.min(items.length - 1, index))
    onActiveChange(i)
    virtualizer.scrollToIndex(i, { align: 'auto' })
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return
    switch (e.key) {
      case 'ArrowDown':
        moveTo(activeIndex + 1)
        break
      case 'ArrowUp':
        moveTo(activeIndex - 1)
        break
      case 'Home':
        moveTo(0)
        break
      case 'End':
        moveTo(items.length - 1)
        break
      case 'Enter': {
        const hit = items[activeIndex]
        if (hit) onReveal(hit)
        break
      }
      case 'Escape':
        onEscape()
        break
      default:
        return
    }
    e.preventDefault()
  }

  const onContextMenu = (
    e: MouseEvent<HTMLDivElement> & { preventBaseUIHandler?: () => void }
  ): void => {
    const row = (e.target as HTMLElement).closest<HTMLElement>('[data-index]')
    const index = row ? Number(row.dataset.index) : -1
    const hit = items[index]
    if (!hit) {
      // 空白处没有菜单
      e.preventBaseUIHandler?.()
      return
    }
    setMenuHit(hit)
    onActiveChange(index)
  }

  const reportError = (e: unknown): void => {
    notify('error', t(`errors:${e instanceof AppError ? e.code : 'UNKNOWN'}`))
  }
  const copy = (text: string, message: string): void => {
    call('system.copyText', { text })
      .then(() => notify('success', message))
      .catch(reportError)
  }
  // 「复制路径」：本地为 Windows 路径，远程为服务器上的绝对路径；「在资源管理器中显示」只对本机资源
  const menuPath = menuHit === null ? null : copyablePath(menuHit.uri)
  const menuLocal = menuHit !== null && isLocalUri(menuHit.uri)
  const activeRendered = rows.some((r) => r.index === activeIndex)

  return (
    <ContextMenu>
      <ContextMenuTrigger onContextMenu={onContextMenu} className="block h-full">
        <div
          ref={listRef}
          role="listbox"
          aria-label={label}
          aria-activedescendant={activeRendered ? `${baseId}-${activeIndex}` : undefined}
          tabIndex={0}
          onKeyDown={onKeyDown}
          className="group/list h-full overflow-auto outline-none"
        >
          <div
            role="presentation"
            className="relative w-full"
            style={{ height: virtualizer.getTotalSize() }}
          >
            {rows.map((r) => {
              const hit = items[r.index]
              if (!hit) return null
              return (
                <ResultRow
                  key={r.key}
                  ref={virtualizer.measureElement}
                  id={`${baseId}-${r.index}`}
                  index={r.index}
                  setSize={items.length}
                  hit={hit}
                  terms={terms}
                  entryLabel={entryLabels.get(hit.entryId) ?? ''}
                  path={displayPath(hit.uri, connectionNames)}
                  selected={r.index === activeIndex}
                  start={r.start}
                  onClick={() => {
                    onActiveChange(r.index)
                    onReveal(hit)
                  }}
                />
              )
            })}
          </div>
        </div>
      </ContextMenuTrigger>
      {menuHit === null ? null : (
        <ContextMenuContent finalFocus={listRef} className="min-w-52">
          <ContextMenuItem onClick={() => onReveal(menuHit)}>
            <ListTreeIcon />
            {t('search:revealInTree')}
          </ContextMenuItem>
          {menuLocal ? (
            <ContextMenuItem
              onClick={() => call('system.revealInOs', { uri: menuHit.uri }).catch(reportError)}
            >
              <FolderSearchIcon />
              {t('explorer:reveal')}
            </ContextMenuItem>
          ) : null}
          <ContextMenuSeparator />
          {menuPath === null ? null : (
            <ContextMenuItem onClick={() => copy(menuPath, t('explorer:copiedPath'))}>
              <CopyIcon />
              {t('explorer:copyPath')}
            </ContextMenuItem>
          )}
          <ContextMenuItem onClick={() => copy(menuHit.uri, t('explorer:copiedUri'))}>
            <LinkIcon />
            {t('explorer:copyUri')}
          </ContextMenuItem>
        </ContextMenuContent>
      )}
    </ContextMenu>
  )
}

function ResultRow({
  ref,
  id,
  index,
  setSize,
  hit,
  terms,
  entryLabel,
  path,
  selected,
  start,
  onClick
}: {
  ref: (el: HTMLElement | null) => void
  id: string
  index: number
  /** 结果总行数（aria-setsize） */
  setSize: number
  hit: SearchHit
  terms: SearchTerm[]
  entryLabel: string
  /** 悬停提示的显示路径（本地为 Windows 路径，远程为 `<连接名>:<路径>`） */
  path: string
  selected: boolean
  start: number
  onClick: () => void
}): JSX.Element {
  const { head, tail } = locationParts(hit, entryLabel)

  return (
    <div
      ref={ref}
      id={id}
      role="option"
      aria-selected={selected}
      // 虚拟滚动只渲染视口附近的行：显式给出在整个结果中的位置（读屏读「第 N 项，共 M 项」）
      aria-posinset={index + 1}
      aria-setsize={setSize}
      data-index={index}
      onClick={onClick}
      title={path}
      style={{ transform: `translateY(${start}px)` }}
      className={cn(
        'absolute top-0 left-0 flex w-full cursor-default items-start gap-2 px-3 py-1 select-none',
        selected
          ? 'bg-sidebar-accent text-sidebar-accent-foreground group-focus/list:outline group-focus/list:-outline-offset-1 group-focus/list:outline-sidebar-ring'
          : 'hover:bg-sidebar-accent/50'
      )}
    >
      <FileIcon
        name={hit.name}
        kind={hit.kind}
        // 命中项不带链接目标类型：链接按「指向文件」显示，不当作失效链接
        target={hit.kind === 'symlink' ? 'file' : undefined}
        monochrome={selected}
        className="mt-0.5 size-4 shrink-0"
      />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px]">
          <Highlighted name={hit.name} terms={terms} />
        </div>
        <div className="flex min-w-0 text-xs text-muted-foreground">
          <span className="min-w-0 truncate">{head}</span>
          {tail === null ? null : (
            <span className="max-w-[60%] shrink-0 truncate">
              {' › '}
              {tail}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

/** 名称中与搜索词匹配的片段用 <mark> 标出（规则与搜索相同：@pch/shared 的 matchRanges） */
function Highlighted({ name, terms }: { name: string; terms: SearchTerm[] }): JSX.Element {
  const ranges = matchRanges(name, terms)
  const parts: JSX.Element[] = []
  let pos = 0
  for (const r of ranges) {
    if (r.start > pos) parts.push(<span key={`t${pos}`}>{name.slice(pos, r.start)}</span>)
    parts.push(
      <mark
        key={`m${r.start}`}
        className="rounded-[2px] bg-primary/10 font-semibold text-foreground"
      >
        {name.slice(r.start, r.end)}
      </mark>
    )
    pos = r.end
  }
  if (pos < name.length) parts.push(<span key={`t${pos}`}>{name.slice(pos)}</span>)
  return <>{parts}</>
}
