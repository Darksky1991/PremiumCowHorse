import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import type { RecentItem } from '@pch/shared'
import { call } from '@renderer/lib/ipc'
import { queryKeys } from '@renderer/lib/query-keys'

/**
 * 最近使用（M5）。主进程在记录 / 清除后广播 recent.changed，缓存由 query-client 的桥接失效；
 * 写操作不需要自己失效缓存。
 */

/** 工作区的最近使用（openedAt 降序）；workspaceId 为 undefined 时不查询 */
export function useRecent(
  workspaceId: string | undefined,
  limit: number
): UseQueryResult<RecentItem[]> {
  return useQuery({
    queryKey: queryKeys.recent(workspaceId ?? ''),
    queryFn: () => call('recent.list', { workspaceId: workspaceId!, limit }),
    enabled: workspaceId !== undefined
  })
}

/** 记录一次明确的打开（RecentRecorder 调用） */
export function recordRecent(
  workspaceId: string,
  item: Pick<RecentItem, 'uri' | 'kind' | 'title'>
): Promise<void> {
  return call('recent.record', { workspaceId, ...item })
}

/** 清除最近使用：省略 workspaceId = 全部工作区 */
export function clearRecent(workspaceId?: string): Promise<void> {
  return call('recent.clear', workspaceId === undefined ? {} : { workspaceId })
}
