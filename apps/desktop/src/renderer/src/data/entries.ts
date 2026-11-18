import {
  useMutation,
  useQuery,
  type UseMutationResult,
  type UseQueryResult
} from '@tanstack/react-query'
import type { EntryAddInput, EntryMoveInput, EntryUpdateInput, WorkspaceEntry } from '@pch/shared'
import { call } from '@renderer/lib/ipc'
import { queryKeys } from '@renderer/lib/query-keys'

export function useEntries(workspaceId: string | undefined): UseQueryResult<WorkspaceEntry[]> {
  return useQuery({
    queryKey: queryKeys.entries(workspaceId ?? ''),
    queryFn: () => call('entry.list', { workspaceId: workspaceId as string }),
    enabled: workspaceId !== undefined
  })
}

export interface EntryActions {
  add: UseMutationResult<WorkspaceEntry, Error, EntryAddInput>
  update: UseMutationResult<WorkspaceEntry, Error, EntryUpdateInput>
  remove: UseMutationResult<void, Error, string>
  move: UseMutationResult<void, Error, EntryMoveInput>
}

/** 写操作成功后主进程会广播 workspace.changed，条目缓存由 query-client 的桥接失效 */
export function useEntryActions(): EntryActions {
  const add = useMutation({ mutationFn: (input: EntryAddInput) => call('entry.add', input) })
  const update = useMutation({
    mutationFn: (input: EntryUpdateInput) => call('entry.update', input)
  })
  const remove = useMutation({ mutationFn: (id: string) => call('entry.remove', { id }) })
  const move = useMutation({ mutationFn: (input: EntryMoveInput) => call('entry.move', input) })
  return { add, update, remove, move }
}
