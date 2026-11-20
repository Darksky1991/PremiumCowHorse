import {
  useMutation,
  useQuery,
  type UseMutationResult,
  type UseQueryResult
} from '@tanstack/react-query'
import type {
  EntryAddInput,
  EntryMoveInput,
  EntrySetCacheStrategyInput,
  EntryUpdateInput,
  IndexSetTargetInput,
  WorkspaceEntry
} from '@pch/shared'
import { call } from '@renderer/lib/ipc'
import { queryKeys } from '@renderer/lib/query-keys'

export function useEntries(workspaceId: string | undefined): UseQueryResult<WorkspaceEntry[]> {
  return useQuery({
    queryKey: queryKeys.entries(workspaceId ?? ''),
    queryFn: () => call('entry.list', { workspaceId: workspaceId as string }),
    enabled: workspaceId !== undefined
  })
}

/** 工作区中开启了「建立索引」的目录 URI（已规范化）；workspace.changed 后失效 */
export function useIndexTargets(workspaceId: string | undefined): UseQueryResult<string[]> {
  return useQuery({
    queryKey: queryKeys.indexTargets(workspaceId ?? ''),
    queryFn: () => call('index.list', { workspaceId: workspaceId as string }),
    enabled: workspaceId !== undefined
  })
}

export interface EntryActions {
  add: UseMutationResult<WorkspaceEntry, Error, EntryAddInput>
  update: UseMutationResult<WorkspaceEntry, Error, EntryUpdateInput>
  remove: UseMutationResult<void, Error, string>
  move: UseMutationResult<void, Error, EntryMoveInput>
  setCacheStrategy: UseMutationResult<WorkspaceEntry, Error, EntrySetCacheStrategyInput>
  setIndexTarget: UseMutationResult<void, Error, IndexSetTargetInput>
}

/** 写操作成功后主进程会广播 workspace.changed，条目缓存由 query-client 的桥接失效 */
export function useEntryActions(): EntryActions {
  const add = useMutation({ mutationFn: (input: EntryAddInput) => call('entry.add', input) })
  const update = useMutation({
    mutationFn: (input: EntryUpdateInput) => call('entry.update', input)
  })
  const remove = useMutation({ mutationFn: (id: string) => call('entry.remove', { id }) })
  const move = useMutation({ mutationFn: (input: EntryMoveInput) => call('entry.move', input) })
  const setCacheStrategy = useMutation({
    mutationFn: (input: EntrySetCacheStrategyInput) => call('entry.setCacheStrategy', input)
  })
  const setIndexTarget = useMutation({
    mutationFn: (input: IndexSetTargetInput) => call('index.setTarget', input)
  })
  return { add, update, remove, move, setCacheStrategy, setIndexTarget }
}
