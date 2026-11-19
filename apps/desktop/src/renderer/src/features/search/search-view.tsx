import { useEffect, useMemo, useRef, useState, type JSX, type KeyboardEvent } from 'react'
import { CircleAlertIcon, SearchIcon, XIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  AppError,
  parseQuery,
  type SearchHit,
  type SearchKindFilter,
  type SearchResult
} from '@pch/shared'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle
} from '@pch/ui/components/empty'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput
} from '@pch/ui/components/input-group'
import { Spinner } from '@pch/ui/components/spinner'
import { Tabs, TabsList, TabsTrigger } from '@pch/ui/components/tabs'
import { useEntries } from '@renderer/data/entries'
import { hasSearchTerms, useSearch } from '@renderer/data/search'
import { useActiveWorkspace } from '@renderer/data/workspace'
import { useNavigationStore } from '@renderer/stores/navigation-store'
import { useUiStore } from '@renderer/stores/ui-store'
import { formatTotal, relativeTime } from './format'
import { SearchResults } from './search-results'
import { EMPTY_SEARCH, useSearchStore } from './search-store'

/** 输入防抖（设计 3.3） */
const DEBOUNCE_MS = 150
/** 「N 分钟前」的刷新间隔 */
const CLOCK_MS = 30_000

const KINDS = [
  ['all', 'search:kindAll'],
  ['file', 'search:kindFile'],
  ['directory', 'search:kindDirectory']
] as const satisfies readonly (readonly [SearchKindFilter, string])[]

/** 侧栏「搜索」视图：在当前工作区的缓存中按文件名搜索（设计 devDoc/2026-11-19-02 第 3 节） */
export function SearchView(): JSX.Element {
  const { t } = useTranslation()
  const { data: workspace } = useActiveWorkspace()
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-9 shrink-0 items-center px-4">
        <h2 className="min-w-0 flex-1 truncate text-xs font-medium text-muted-foreground">
          {t('search:title')}
        </h2>
      </div>
      {workspace === undefined ? null : (
        // 切换工作区时重建：防抖中的文字、结果列表的位置不跨工作区沿用
        <SearchPanel key={workspace.id} workspaceId={workspace.id} />
      )}
    </div>
  )
}

function SearchPanel({ workspaceId }: { workspaceId: string }): JSX.Element {
  const { t, i18n } = useTranslation()
  const { text, kind } = useSearchStore((s) => s.byWorkspace[workspaceId] ?? EMPTY_SEARCH)
  const setText = useSearchStore((s) => s.setText)
  const setKind = useSearchStore((s) => s.setKind)
  const debounced = useDebounced(text, DEBOUNCE_MS)
  const query = useSearch(workspaceId, debounced, kind)
  const { data: entries } = useEntries(workspaceId)
  const entryLabels = useMemo(() => new Map((entries ?? []).map((e) => [e.id, e.label])), [entries])
  const terms = useMemo(() => parseQuery(debounced).terms, [debounced])

  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // 挂载时（打开搜索视图）与每次 Ctrl+Shift+F 时聚焦搜索框并全选
  const focusRequest = useUiStore((s) => s.searchFocusRequest)
  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [focusRequest])

  // 当前行：结果变化时回到第一行（以结果对象判断，不在 effect 中重置）
  const data = hasSearchTerms(text) && hasSearchTerms(debounced) ? query.data : undefined
  const [active, setActive] = useState<{ data: SearchResult | undefined; index: number }>({
    data: undefined,
    index: 0
  })
  const activeIndex = active.data === data ? active.index : 0
  const setActiveIndex = (index: number): void => setActive({ data, index })

  const requestReveal = useNavigationStore((s) => s.requestReveal)
  const showView = useUiStore((s) => s.showView)
  const reveal = (hit: SearchHit): void => {
    requestReveal(workspaceId, hit.uri)
    showView('explorer')
  }

  const onInputKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'ArrowDown' && data !== undefined && data.items.length > 0) {
      e.preventDefault()
      listRef.current?.focus()
    } else if (e.key === 'Escape' && text !== '') {
      e.preventDefault()
      setText(workspaceId, '')
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-col gap-2 px-3 pb-2">
        <InputGroup>
          <InputGroupAddon>
            <SearchIcon />
          </InputGroupAddon>
          <InputGroupInput
            ref={inputRef}
            // 不用 type="search"（浏览器另有自带的清除行为）：清除按钮与 Esc 由本组件处理，角色仍为 searchbox
            type="text"
            role="searchbox"
            aria-label={t('search:inputLabel')}
            placeholder={t('search:placeholder')}
            value={text}
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => setText(workspaceId, e.target.value)}
            onKeyDown={onInputKeyDown}
          />
          {text === '' ? null : (
            <InputGroupAddon align="inline-end">
              <InputGroupButton
                size="icon-xs"
                aria-label={t('search:clear')}
                onClick={() => {
                  setText(workspaceId, '')
                  inputRef.current?.focus()
                }}
              >
                <XIcon />
              </InputGroupButton>
            </InputGroupAddon>
          )}
        </InputGroup>
        {/* 类型筛选：分段切换（只切换下面结果列表的内容，没有单独的面板） */}
        <Tabs
          value={kind}
          onValueChange={(value) => setKind(workspaceId, value as SearchKindFilter)}
        >
          <TabsList aria-label={t('search:kindLabel')} className="w-full">
            {KINDS.map(([value, key]) => (
              <TabsTrigger key={value} value={value}>
                {t(key)}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        {data === undefined ? null : (
          <Summary result={data} fetching={query.isFetching} language={i18n.language} />
        )}
      </div>
      <div className="min-h-0 flex-1">
        {!hasSearchTerms(text) ? (
          <Hint title={null} />
        ) : query.isError ? (
          <ErrorState error={query.error} />
        ) : data === undefined ? (
          <div className="flex items-center gap-2 px-4 text-xs text-muted-foreground">
            <Spinner aria-hidden />
          </div>
        ) : data.items.length === 0 ? (
          <Hint title={t('search:noResults')} />
        ) : (
          <SearchResults
            items={data.items}
            terms={terms}
            entryLabels={entryLabels}
            activeIndex={activeIndex}
            onActiveChange={setActiveIndex}
            onReveal={reveal}
            onEscape={() => inputRef.current?.focus()}
            listRef={listRef}
            label={t('search:resultsLabel')}
          />
        )}
      </div>
      {data?.truncated && data.items.length > 0 ? (
        <p className="shrink-0 border-t px-3 py-1.5 text-xs text-muted-foreground">
          {t('search:truncated', {
            limit: new Intl.NumberFormat(i18n.language).format(data.items.length)
          })}
        </p>
      ) : null}
    </div>
  )
}

/** 「1,234 件 · キャッシュから検索（最終更新：3 分前）」与「部分目录尚未扫描」 */
function Summary({
  result,
  fetching,
  language
}: {
  result: SearchResult
  fetching: boolean
  language: string
}): JSX.Element {
  const { t } = useTranslation()
  const now = useNow(CLOCK_MS)
  const cache =
    result.indexedAt === null
      ? null
      : t('search:basedOnCache', {
          time: relativeTime(result.indexedAt, now, language) ?? t('search:justNow')
        })
  return (
    <div role="status" className="flex flex-col gap-0.5 text-xs text-muted-foreground">
      <div className="flex min-w-0 items-center gap-1.5">
        <span className="min-w-0 truncate">
          {[t('search:count', { total: formatTotal(result.total, language) }), cache]
            .filter((s) => s !== null)
            .join(' · ')}
        </span>
        {fetching ? <Spinner aria-hidden className="size-3 shrink-0" /> : null}
      </div>
      {result.incomplete ? <span className="truncate">{t('search:incomplete')}</span> : null}
    </div>
  )
}

/** 空输入（title 为 null）与无结果：范围说明 */
function Hint({ title }: { title: string | null }): JSX.Element {
  const { t } = useTranslation()
  return (
    <Empty className="border-0 p-4">
      <EmptyHeader>
        {title === null ? (
          <EmptyMedia variant="icon">
            <SearchIcon />
          </EmptyMedia>
        ) : (
          <EmptyTitle>{title}</EmptyTitle>
        )}
        <EmptyDescription>{t('search:scopeHint')}</EmptyDescription>
        {title === null ? <EmptyDescription>{t('search:wildcardHint')}</EmptyDescription> : null}
      </EmptyHeader>
    </Empty>
  )
}

/** 扫描进程不可用（INDEX_UNAVAILABLE）显示「搜索不可用」与原因；其他错误只显示原因 */
function ErrorState({ error }: { error: unknown }): JSX.Element {
  const { t } = useTranslation()
  const code = error instanceof AppError ? error.code : 'UNKNOWN'
  return (
    <Empty className="border-0 p-4">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <CircleAlertIcon />
        </EmptyMedia>
        {code === 'INDEX_UNAVAILABLE' ? (
          <EmptyTitle>{t('search:unavailableTitle')}</EmptyTitle>
        ) : null}
        <EmptyDescription>{t(`errors:${code}`)}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}

/** value 停止变化 ms 毫秒后才更新；初值立即生效（切回搜索视图时不必等待） */
function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms)
    return () => clearTimeout(id)
  }, [value, ms])
  return debounced
}

/** 每 ms 毫秒更新一次的当前时刻 */
function useNow(ms: number): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(id)
  }, [ms])
  return now
}
