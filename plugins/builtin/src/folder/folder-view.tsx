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
import {
  ArrowDownIcon,
  ArrowUpIcon,
  ChevronRightIcon,
  FileIcon,
  FileSymlinkIcon,
  FileXIcon,
  FolderIcon,
  FolderSymlinkIcon,
  UnplugIcon,
  type LucideIcon
} from 'lucide-react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { DirectoryListing, FileEntry, PreviewHost, PreviewProps } from '@pch/plugin-sdk'
import { Button } from '@pch/ui/components/button'
import { Spinner } from '@pch/ui/components/spinner'
import { formatSize, formatTime } from './format'
import {
  breadcrumb,
  DEFAULT_SORT,
  extensionOf,
  isDirectoryLike,
  parentOf,
  sortEntries,
  visibleEntries,
  type FolderViewState,
  type Sort,
  type SortKey
} from './model'

/** 默认密度下的行高；实际高度由 measureElement 测量（紧凑密度下随 --spacing 变小） */
const ROW_ESTIMATE = 28
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
 * 重新列出期间保留当前内容；出错时显示错误（错误优先于旧内容）。retry 重新列出。
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
  const retry = (): void => {
    setListing({ status: 'loading' })
    setAttempt((n) => n + 1)
  }
  return [listing, retry]
}

function iconOf(e: FileEntry): LucideIcon {
  if (e.kind === 'directory') return FolderIcon
  if (e.kind === 'file') return FileIcon
  if (e.target === 'directory') return FolderSymlinkIcon
  return e.target === 'file' ? FileSymlinkIcon : FileXIcon
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
 * 目录视图（folder 插件）：面包屑 +「上一级」、详细信息列表（虚拟滚动）、状态行（项目数 / 已断开 / 读取中）。
 * 单击只选中（预览标签不转常驻）；双击 / Enter 打开：目录在同一标签内导航，文件以常驻标签打开；
 * Backspace / Alt+↑ 到上一级。打开与导航都经 host（宿主据此把预览标签转为常驻）；
 * 导航时给出类型（目录），宿主不再 stat。
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
  const [selectedUri, setSelectedUri] = useState<string | null>(null)

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

  // 在标签内导航后（旧视图连同焦点一起被移除）焦点回到列表，键盘操作可以继续
  useEffect(() => {
    const active = document.activeElement
    if (active === null || active === document.body) gridRef.current?.focus()
  }, [])

  const parent = parentOf(resource.uri)
  const crumbs = breadcrumb(resource.uri, host.fs.rootOf(resource.uri))

  const open = (entry: FileEntry): void => {
    if (isDirectoryLike(entry)) host.tabs.navigate(entry.uri, 'directory')
    else host.tabs.open(entry.uri, { preview: false })
  }
  const goUp = (): void => {
    if (parent !== null) host.tabs.navigate(parent, 'directory')
  }
  const sortBy = (key: SortKey): void => {
    const next: Sort =
      sort.key === key ? { key, dir: sort.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }
    onViewStateChange({ sort: next })
  }
  const select = (index: number): void => {
    const row = rows[index]
    if (!row) return
    setSelectedUri(row.uri)
    virtualizer.scrollToIndex(index, { align: 'auto' })
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    // 表头按钮等子元素上的按键不在这里处理
    if (e.target !== e.currentTarget) return
    if ((e.key === 'ArrowUp' && e.altKey) || (e.key === 'Backspace' && !e.altKey)) {
      e.preventDefault()
      goUp()
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
    <div className="flex h-full flex-col text-[13px]">
      <div className="flex h-9 shrink-0 items-center gap-1 border-b px-2">
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={t('up')}
          title={t('up')}
          disabled={parent === null}
          onClick={goUp}
        >
          <ArrowUpIcon />
        </Button>
        <nav aria-label={t('breadcrumb')} className="min-w-0 flex-1">
          <ol className="flex min-w-0 items-center overflow-hidden">
            {crumbs.map((c, i) => {
              const current = i === crumbs.length - 1
              return (
                <li key={c.uri} className="flex min-w-0 shrink items-center">
                  {i > 0 ? (
                    <ChevronRightIcon
                      aria-hidden
                      className="size-3.5 shrink-0 text-muted-foreground"
                    />
                  ) : null}
                  {current ? (
                    <span aria-current="page" className="truncate px-2 font-medium" title={c.label}>
                      {c.label}
                    </span>
                  ) : (
                    <Button
                      variant="ghost"
                      size="xs"
                      className="min-w-0"
                      title={c.label}
                      onClick={() => host.tabs.navigate(c.uri, 'directory')}
                    >
                      <span className="truncate">{c.label}</span>
                    </Button>
                  )}
                </li>
              )
            })}
          </ol>
        </nav>
      </div>

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
        <div ref={scrollRef} role="rowgroup" className="min-h-0 flex-1 overflow-y-auto">
          {body ?? (
            <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
              {virtualRows.map((v) => {
                const entry = rows[v.index]
                if (!entry) return null
                const Icon = iconOf(entry)
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
                    onClick={() => setSelectedUri(entry.uri)}
                    onDoubleClick={() => open(entry)}
                    style={{ transform: `translateY(${v.start}px)` }}
                    className={`${COLUMNS} absolute top-0 left-0 h-7 w-full cursor-default select-none ${
                      selected
                        ? 'bg-accent text-accent-foreground group-focus/grid:outline group-focus/grid:-outline-offset-1 group-focus/grid:outline-ring'
                        : 'hover:bg-accent/50'
                    }`}
                  >
                    <div role="gridcell" className="flex min-w-0 items-center gap-2">
                      <Icon
                        aria-hidden
                        className={`size-4 shrink-0 ${
                          entry.kind === 'symlink' && entry.target === null
                            ? 'text-destructive'
                            : 'text-muted-foreground'
                        }`}
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
