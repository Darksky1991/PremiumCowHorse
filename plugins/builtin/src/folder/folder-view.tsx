import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type JSX,
  type KeyboardEvent,
  type ReactNode
} from 'react'
import { ArrowDownIcon, ArrowUpIcon, UnplugIcon } from 'lucide-react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { DirectoryListing, FileEntry, PreviewHost, PreviewProps } from '@pch/plugin-sdk'
import { FileIcon } from '@pch/ui/file-icon'
import { Button } from '@pch/ui/components/button'
import { Spinner } from '@pch/ui/components/spinner'
import { formatSize, formatTime } from './format'
import {
  DEFAULT_SORT,
  extensionOf,
  isDirectoryLike,
  sortEntries,
  visibleEntries,
  type FolderViewState,
  type Sort,
  type SortKey
} from './model'

/** 默认密度下的行高；实际高度由 measureElement 测量（紧凑密度下随 --spacing 变小） */
const ROW_ESTIMATE = 28
/** 滚动停止后多久把滚动位置存入 viewState（避免每帧写 store） */
const SCROLL_SAVE_DELAY = 150
/** 列：名称、修改时间、类型、大小（表头与各行共用） */
const COLUMNS = 'grid grid-cols-[minmax(0,1fr)_9rem_9rem_6rem] items-center gap-4 px-3'
const COLUMN_KEYS: SortKey[] = ['name', 'mtime', 'type', 'size']
const COLUMN_LABEL: Record<SortKey, string> = {
  name: 'colName',
  mtime: 'colModified',
  type: 'colType',
  size: 'colSize'
}

type Listing =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; listing: DirectoryListing }

/**
 * 目录列表：经 host.fs.list 取得（缓存优先），该目录的缓存有变化（host.fs.subscribe）时重新列出。
 * 重新列出期间保留当前内容；出错时显示错误（错误优先于旧内容）。
 * retry 显示读取中后重新列出；刷新（应用地址栏的刷新按钮 / F5，经 host.tabs.onRefresh）让宿主
 * 立即确认该目录（host.fs.refresh），再重新列出，期间保留当前内容——降级模式（扫描进程不可用、
 * 直接枚举）与条目之外的目录（不进缓存）都没有 vfs.changed，列表不会自动更新，由它补上
 */
function useListing(host: PreviewHost, uri: string): [Listing, () => void] {
  const [listing, setListing] = useState<Listing>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let alive = true
    let seq = 0
    const load = (): void => {
      const current = ++seq
      host.fs.list(uri).then(
        (result) => {
          if (alive && current === seq) setListing({ status: 'ready', listing: result })
        },
        (error: unknown) => {
          if (alive && current === seq) {
            setListing({ status: 'error', message: host.i18n.describeError(error) })
          }
        }
      )
    }
    load()
    const off = host.fs.subscribe(uri, load)
    return () => {
      alive = false
      off()
    }
  }, [host, uri, attempt])
  useEffect(() => {
    let alive = true
    const off = host.tabs.onRefresh(() => {
      void host.fs.refresh(uri).finally(() => {
        if (alive) setAttempt((n) => n + 1)
      })
    })
    return () => {
      alive = false
      off()
    }
  }, [host, uri])
  const retry = (): void => {
    setListing({ status: 'loading' })
    setAttempt((n) => n + 1)
  }
  return [listing, retry]
}

function typeLabel(e: FileEntry, t: PreviewHost['i18n']['t']): string {
  if (e.kind === 'directory') return t('typeFolder')
  if (e.kind === 'symlink') {
    if (e.target === 'directory') return t('typeFolderLink')
    return t(e.target === 'file' ? 'typeFileLink' : 'typeBrokenLink')
  }
  const ext = extensionOf(e.name)
  return ext === '' ? t('typeFileNoExt') : t('typeFile', { ext: ext.toUpperCase() })
}

/** 有大小的项：文件与指向文件的链接（目录、失效链接不显示） */
const hasSize = (e: FileEntry): boolean =>
  e.kind === 'file' || (e.kind === 'symlink' && e.target === 'file')

/**
 * 目录视图（folder 插件）：详细信息列表（虚拟滚动）、状态行（项目数 / 已断开 / 读取中）。
 * 单击只选中；双击 / Enter 在当前标签打开（host.tabs.navigate：目录与文件都进入标签的历史，「后退」回到列表）；
 * 中键 / Ctrl+单击 / Ctrl+Enter 在新标签打开（host.tabs.open）（设计 2.8）；
 * Backspace / Alt+↑ 经 host.tabs.up 到逻辑路径的上一级（条目根之上是工作区总览）；
 * 刷新（重新确认并列出）由应用的地址栏发出（刷新按钮 / 全局 F5），经 host.tabs.onRefresh 收到。
 * 导航时给出已知的类型（目录 / 普通文件），宿主不再 stat；链接（指向文件或失效）由宿主 stat。
 */
export default function FolderView({
  resource,
  host,
  viewState,
  onViewStateChange
}: PreviewProps<FolderViewState>): JSX.Element {
  const { t, language } = host.i18n
  const baseId = useId()
  const gridRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [listing, retry] = useListing(host, resource.uri)
  const showHidden = host.settings.get('explorer.showHiddenFiles') ?? false
  const sort = viewState?.sort ?? DEFAULT_SORT
  // 选中项与滚动位置存入 viewState：后退 / 前进回到本目录时恢复（视图按 URI 重建，初值取自 viewState）
  const [selectedUri, setSelectedUri] = useState<string | null>(viewState?.selectedUri ?? null)
  const viewStateRef = useRef(viewState)
  useEffect(() => {
    viewStateRef.current = viewState
  }, [viewState])
  const saveViewState = (patch: Partial<FolderViewState>): void => {
    const next: FolderViewState = { sort: DEFAULT_SORT, ...viewStateRef.current, ...patch }
    viewStateRef.current = next
    onViewStateChange(next)
  }
  const selectUri = (uri: string): void => {
    setSelectedUri(uri)
    if (viewStateRef.current?.selectedUri !== uri) saveViewState({ selectedUri: uri })
  }
  const scrollSaveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  // 卸载时丢弃防抖中的滚动位置（宿主已按位置写入刚离开的历史项，也可以在卸载时补存，见 text 插件；未做）
  useEffect(() => () => clearTimeout(scrollSaveTimer.current), [])
  const onScroll = (): void => {
    clearTimeout(scrollSaveTimer.current)
    scrollSaveTimer.current = setTimeout(() => {
      const top = scrollRef.current?.scrollTop
      if (top !== undefined && top !== viewStateRef.current?.scrollTop) {
        saveViewState({ scrollTop: top })
      }
    }, SCROLL_SAVE_DELAY)
  }

  const items = listing.status === 'ready' ? listing.listing.items : null
  const rows = useMemo(
    () =>
      items === null ? [] : sortEntries(visibleEntries(items, showHidden), sort.key, sort.dir),
    [items, showHidden, sort.key, sort.dir]
  )
  const selectedIndex = selectedUri === null ? -1 : rows.findIndex((r) => r.uri === selectedUri)

  // 本项目未启用 React Compiler；该规则只提示「编译器会跳过此组件」，不影响运行
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_ESTIMATE,
    getItemKey: (i) => rows[i]?.uri ?? i,
    overscan: 10
  })
  const virtualRows = virtualizer.getVirtualItems()

  // 列表首次就绪时恢复保存的滚动位置（只一次；之后的滚动由用户决定）
  const scrollRestored = useRef(false)
  const hasRows = rows.length > 0
  useEffect(() => {
    if (!hasRows || scrollRestored.current) return
    scrollRestored.current = true
    const top = viewStateRef.current?.scrollTop
    if (top !== undefined && top > 0) virtualizer.scrollToOffset(top)
  }, [hasRows, virtualizer])

  // 在标签内导航后（旧视图连同焦点一起被移除）焦点回到列表，键盘操作可以继续
  useEffect(() => {
    const active = document.activeElement
    if (active === null || active === document.body) gridRef.current?.focus()
  }, [])

  /** 在当前标签打开；newTab 时在新标签打开 */
  const open = (entry: FileEntry, newTab = false): void => {
    if (newTab) host.tabs.open(entry.uri)
    else if (isDirectoryLike(entry)) host.tabs.navigate(entry.uri, 'directory')
    else host.tabs.navigate(entry.uri, entry.kind === 'file' ? 'file' : undefined)
  }
  const sortBy = (key: SortKey): void => {
    const next: Sort =
      sort.key === key ? { key, dir: sort.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }
    saveViewState({ sort: next })
  }
  const select = (index: number): void => {
    const row = rows[index]
    if (!row) return
    selectUri(row.uri)
    virtualizer.scrollToIndex(index, { align: 'auto' })
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    // 表头按钮等子元素上的按键不在这里处理
    if (e.target !== e.currentTarget) return
    if ((e.key === 'ArrowUp' && e.altKey) || (e.key === 'Backspace' && !e.altKey)) {
      e.preventDefault()
      host.tabs.up()
      return
    }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey) {
      e.preventDefault()
      const row = rows[selectedIndex]
      if (row) open(row, true)
      return
    }
    if (e.altKey || e.ctrlKey || e.metaKey) return
    const last = rows.length - 1
    const page = Math.max(
      1,
      Math.floor((scrollRef.current?.clientHeight ?? ROW_ESTIMATE) / ROW_ESTIMATE) - 1
    )
    const from = selectedIndex
    switch (e.key) {
      case 'ArrowDown':
        select(from < 0 ? 0 : Math.min(last, from + 1))
        break
      case 'ArrowUp':
        select(from < 0 ? 0 : Math.max(0, from - 1))
        break
      case 'PageDown':
        select(Math.min(last, Math.max(0, from) + page))
        break
      case 'PageUp':
        select(Math.max(0, from - page))
        break
      case 'Home':
        select(0)
        break
      case 'End':
        select(last)
        break
      case 'Enter': {
        const row = rows[from]
        if (row) open(row)
        break
      }
      default:
        return
    }
    e.preventDefault()
  }

  const rowDomId = (index: number): string => `${baseId}-row-${index}`
  const selectedRendered = virtualRows.some((v) => v.index === selectedIndex)

  let body: ReactNode = null
  if (listing.status === 'loading') {
    body = (
      <Centered>
        <Spinner aria-label={t('loading')} />
      </Centered>
    )
  } else if (listing.status === 'error') {
    body = (
      <Centered>
        <p role="alert" className="text-sm text-muted-foreground">
          {listing.message}
        </p>
        <Button variant="outline" size="sm" onClick={retry}>
          {t('retry')}
        </Button>
      </Centered>
    )
  } else if (rows.length === 0) {
    body = (
      <Centered>
        <p className="text-sm text-muted-foreground">{t('empty')}</p>
      </Centered>
    )
  }

  return (
    // 路径、上一级、后退 / 前进与刷新都由应用的地址栏提供（M1-3b），视图不再有工具栏
    <div className="flex h-full flex-col text-[13px]">
      <div
        ref={gridRef}
        role="grid"
        aria-label={resource.name}
        aria-rowcount={rows.length + 1}
        aria-activedescendant={selectedRendered ? rowDomId(selectedIndex) : undefined}
        tabIndex={0}
        onKeyDown={onKeyDown}
        className="group/grid flex min-h-0 flex-1 flex-col outline-none"
      >
        <div role="rowgroup" className="shrink-0 border-b">
          <div role="row" aria-rowindex={1} className={`${COLUMNS} h-8`}>
            {COLUMN_KEYS.map((key) => {
              const active = sort.key === key
              const SortIcon = sort.dir === 'asc' ? ArrowUpIcon : ArrowDownIcon
              return (
                <div
                  key={key}
                  role="columnheader"
                  aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                  className={`flex min-w-0 ${key === 'size' ? 'justify-end' : ''}`}
                >
                  <Button
                    variant="ghost"
                    size="xs"
                    className="-mx-2 min-w-0 text-muted-foreground"
                    onClick={() => sortBy(key)}
                  >
                    <span className="truncate">{t(COLUMN_LABEL[key])}</span>
                    {active ? <SortIcon aria-hidden data-icon="inline-end" /> : null}
                  </Button>
                </div>
              )
            })}
          </div>
        </div>
        <div
          ref={scrollRef}
          role="rowgroup"
          onScroll={onScroll}
          className="min-h-0 flex-1 overflow-y-auto"
        >
          {body ?? (
            <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
              {virtualRows.map((v) => {
                const entry = rows[v.index]
                if (!entry) return null
                const selected = v.index === selectedIndex
                return (
                  <div
                    key={v.key}
                    ref={virtualizer.measureElement}
                    id={rowDomId(v.index)}
                    role="row"
                    aria-rowindex={v.index + 2}
                    aria-selected={selected}
                    data-index={v.index}
                    onClick={(e) => {
                      selectUri(entry.uri)
                      if (e.detail === 1 && (e.ctrlKey || e.metaKey)) open(entry, true)
                    }}
                    onDoubleClick={(e) => {
                      if (!e.ctrlKey && !e.metaKey) open(entry)
                    }}
                    // 中键：按下时阻止自动滚动，auxclick 时在新标签打开
                    onMouseDown={(e) => {
                      if (e.button === 1) e.preventDefault()
                    }}
                    onAuxClick={(e) => {
                      if (e.button !== 1) return
                      e.preventDefault()
                      open(entry, true)
                    }}
                    style={{ transform: `translateY(${v.start}px)` }}
                    className={`${COLUMNS} absolute top-0 left-0 h-7 w-full cursor-default select-none ${
                      selected
                        ? 'bg-accent text-accent-foreground group-focus/grid:outline group-focus/grid:-outline-offset-1 group-focus/grid:outline-ring'
                        : 'hover:bg-accent/50'
                    }`}
                  >
                    <div role="gridcell" className="flex min-w-0 items-center gap-2">
                      <FileIcon
                        name={entry.name}
                        kind={entry.kind}
                        target={entry.target}
                        className="size-4 shrink-0 text-muted-foreground"
                      />
                      <span
                        className={`truncate ${entry.hidden ? 'text-muted-foreground' : ''}`}
                        title={entry.name}
                      >
                        {entry.name}
                      </span>
                    </div>
                    <div role="gridcell" className="truncate text-muted-foreground tabular-nums">
                      {formatTime(entry.mtime, language)}
                    </div>
                    <div role="gridcell" className="truncate text-muted-foreground">
                      {typeLabel(entry, t)}
                    </div>
                    <div
                      role="gridcell"
                      className="truncate text-right text-muted-foreground tabular-nums"
                    >
                      {hasSize(entry) ? formatSize(entry.size, language) : ''}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      <StatusLine listing={listing} count={rows.length} host={host} />
    </div>
  )
}

/**
 * 状态行：项目数、已断开（offline）、读取中。
 * 不显示「基于缓存（N 前）」（控制者裁定）：检查后内容没有变化时扫描进程不广播 vfs.changed，
 * 这里的 checkedAt 不会更新，「N 前」越来越旧，而该目录实际每 5 秒都确认过，显示出来会误导用户
 */
function StatusLine({
  listing,
  count,
  host
}: {
  listing: Listing
  count: number
  host: PreviewHost
}): JSX.Element {
  const { t, language } = host.i18n
  const state: ReactNode =
    listing.status === 'ready' && listing.listing.state === 'offline' ? (
      <span className="flex min-w-0 items-center gap-1">
        <UnplugIcon aria-hidden className="size-3.5 shrink-0" />
        <span className="truncate">{t('offline')}</span>
      </span>
    ) : null
  return (
    <div
      role="status"
      className="flex h-7 shrink-0 items-center gap-4 border-t px-3 text-xs text-muted-foreground"
    >
      {listing.status === 'ready' ? (
        <span>{t('items', { count, n: new Intl.NumberFormat(language).format(count) })}</span>
      ) : null}
      {listing.status === 'loading' ? <span>{t('loading')}</span> : null}
      {state}
    </div>
  )
}

function Centered({ children }: { children: ReactNode }): JSX.Element {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6">{children}</div>
  )
}
