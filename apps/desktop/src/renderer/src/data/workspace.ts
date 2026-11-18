import {
  useMutation,
  useQuery,
  type UseMutationResult,
  type UseQueryResult
} from '@tanstack/react-query'
import type { Workspace, WorkspaceCreateInput, WorkspaceUpdateInput } from '@pch/shared'
import { call } from '@renderer/lib/ipc'
import { queryKeys } from '@renderer/lib/query-keys'

export function useWorkspaces(): UseQueryResult<Workspace[]> {
  return useQuery({
    queryKey: queryKeys.workspaces,
    queryFn: () => call('workspace.list', undefined)
  })
}

export function useActiveWorkspace(): UseQueryResult<Workspace> {
  return useQuery({
    queryKey: queryKeys.activeWorkspace,
    queryFn: () => call('workspace.active', undefined)
  })
}

export interface WorkspaceActions {
  create: UseMutationResult<Workspace, Error, WorkspaceCreateInput>
  update: UseMutationResult<Workspace, Error, WorkspaceUpdateInput>
  remove: UseMutationResult<void, Error, string>
  activate: UseMutationResult<void, Error, string>
}

/** 写操作成功后主进程会广播 workspace.changed，缓存由 query-client 的桥接失效 */
export function useWorkspaceActions(): WorkspaceActions {
  const create = useMutation({
    mutationFn: (input: WorkspaceCreateInput) => call('workspace.create', input)
  })
  const update = useMutation({
    mutationFn: (input: WorkspaceUpdateInput) => call('workspace.update', input)
  })
  const remove = useMutation({
    mutationFn: (id: string) => call('workspace.delete', { id })
  })
  const activate = useMutation({
    mutationFn: (id: string) => call('workspace.activate', { id })
  })
  return { create, update, remove, activate }
}

/** 工作区显示名：name 为空（默认工作区恢复默认名称）时用本地化的默认名 */
export function workspaceDisplayName(w: Workspace, defaultName: string): string {
  return w.name === '' ? defaultName : w.name
}
