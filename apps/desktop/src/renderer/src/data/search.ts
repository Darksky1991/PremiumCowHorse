import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { parseQuery, type SearchKindFilter, type SearchResult } from '@pch/shared'
import { call } from '@renderer/lib/ipc'
import { queryKeys } from '@renderer/lib/query-keys'
import type { Invoke } from './vfs'

export interface SearchInput {
  workspaceId: string
  text: string
  kind: SearchKindFilter
  /** 省略 = 主进程的默认条数；命令面板只取前 20 条 */
  limit?: number
}

/** 是否有搜索词（与主进程同一份 parseQuery：空白不算） */
export function hasSearchTerms(text: string): boolean {
  return parseQuery(text).terms.length > 0
}

// requestId 的前缀随页面加载生成：将来的多个窗口各自计数时也不会撞到同一个 id
const REQUEST_PREFIX = `search:${Math.random().toString(36).slice(2, 10)}:`
let requestSeq = 0

/**
 * 执行一次搜索。每次查询用新的 requestId：signal 中止（TanStack Query 取消查询）时以该 id
 * 同步发送 vfs.cancel（与 listDirectory 相同的写法），主进程丢弃这次查询的结果；
 * 若各次查询共用一个 id，旧查询的取消可能落到紧随其后发出的新查询上。
 * 扫描进程中的 SQL 无法中途打断，取消只是不再等待结果。
 */
export async function runSearch(
  input: SearchInput,
  signal: AbortSignal,
  invoke: Invoke = call
): Promise<SearchResult> {
  const requestId = `${REQUEST_PREFIX}${++requestSeq}`
  const onAbort = (): void => {
    void invoke('vfs.cancel', { requestId }).catch(() => undefined)
  }
  signal.addEventListener('abort', onAbort, { once: true })
  try {
    return await invoke('search.query', { ...input, requestId })
  } finally {
    signal.removeEventListener('abort', onAbort)
  }
}

/**
 * 搜索的查询选项。staleTime 为 0：搜索结果来自随时在更新的缓存，重新挂载（切回搜索视图）时重新查询；
 * 不随 vfs.changed 失效（扫描中变化频繁，结果行会不停跳动），界面标注「基于缓存」与更新时刻。
 */
export function searchQuery(
  workspaceId: string | undefined,
  text: string,
  kind: SearchKindFilter,
  invoke: Invoke = call
): {
  queryKey: ReturnType<typeof queryKeys.search>
  queryFn: (context: { signal: AbortSignal }) => Promise<SearchResult>
  staleTime: number
  enabled: boolean
} {
  return {
    queryKey: queryKeys.search(workspaceId ?? '', text, kind),
    queryFn: ({ signal }) =>
      runSearch({ workspaceId: workspaceId as string, text, kind }, signal, invoke),
    staleTime: 0,
    enabled: workspaceId !== undefined && hasSearchTerms(text)
  }
}

/**
 * 搜索结果。输入变化时保留同一工作区的上一次结果直到新结果到达（输入中列表不闪烁）；
 * 不沿用其他工作区的结果。text 由调用方防抖。
 */
export function useSearch(
  workspaceId: string | undefined,
  text: string,
  kind: SearchKindFilter
): UseQueryResult<SearchResult> {
  return useQuery({
    ...searchQuery(workspaceId, text, kind),
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[1] === workspaceId ? previous : undefined
  })
}
