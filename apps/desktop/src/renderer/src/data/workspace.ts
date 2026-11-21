import { useCallback } from 'react'
import {
  useMutation,
  useQuery,
  useQueryClient,
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

/**
 * 返回读取「显示中的工作区」id 的函数：查询缓存中 workspace.active 的当前值（不订阅、不发请求）。
 * 用于卸载清理等拿不到最新渲染值的场合——组件因工作区切换而卸载时，缓存已是触发这次提交的新值
 */
export function useReadActiveWorkspaceId(): () => string | undefined {
  const client = useQueryClient()
  return useCallback(() => client.getQueryData<Workspace>(queryKeys.activeWorkspace)?.id, [client])
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
