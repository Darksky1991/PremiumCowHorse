import {
  useMutation,
  useQuery,
  type UseMutationResult,
  type UseQueryResult
} from '@tanstack/react-query'
import {
  parseSftpUri,
  type ConnectionDto,
  type ConnectionSaveInput,
  type ConnectionTestResult,
  type HostKeyPrompt,
  type WorkspaceEntry
} from '@pch/shared'
import { call, subscribe } from '@renderer/lib/ipc'
import { queryKeys } from '@renderer/lib/query-keys'

/**
 * 远程连接（设计 devDoc/2026-11-22-37 第 5.2、5.3、5.8 节）。
 * 列表在 connection.changed / connection.status 时由 query-client 的桥接失效。
 * 资源管理器的「添加远程文件夹」也经这里取连接列表（feature 之间不互相 import）
 */
export function useConnections(): UseQueryResult<ConnectionDto[]> {
  return useQuery({
    queryKey: queryKeys.connections,
    queryFn: () => call('connection.list', undefined)
  })
}

export interface ConnectionActions {
  save: UseMutationResult<ConnectionDto, Error, ConnectionSaveInput>
  remove: UseMutationResult<void, Error, string>
  test: UseMutationResult<ConnectionTestResult, Error, string>
  reconnect: UseMutationResult<void, Error, string>
  trustHostKey: UseMutationResult<void, Error, string>
}

/** 写操作成功后主进程广播 connection.changed，列表由 query-client 的桥接失效 */
export function useConnectionActions(): ConnectionActions {
  const save = useMutation({
    mutationFn: (input: ConnectionSaveInput) => call('connection.save', input)
  })
  const remove = useMutation({ mutationFn: (id: string) => call('connection.delete', { id }) })
  const test = useMutation({ mutationFn: (id: string) => call('connection.test', { id }) })
  const reconnect = useMutation({
    mutationFn: (id: string) => call('connection.reconnect', { id })
  })
  const trustHostKey = useMutation({
    mutationFn: (id: string) => call('connection.trustHostKey', { id })
  })
  return { save, remove, test, reconnect, trustHostKey }
}

/** 主目录（登录用户会连接服务器）；id 为 undefined 时不查询 */
export function useConnectionHome(
  id: string | undefined,
  identity: string | null
): UseQueryResult<string> {
  return useQuery({
    queryKey: queryKeys.connectionHome(id ?? '', identity),
    queryFn: () => call('connection.home', { id: id as string, identity }),
    enabled: id !== undefined
  })
}

/** 订阅主进程的主机密钥询问（connection.hostKeyPrompt），返回取消订阅函数 */
export function subscribeHostKeyPrompts(listener: (p: HostKeyPrompt) => void): () => void {
  return subscribe('connection.hostKeyPrompt', listener)
}

/** 尚未回答的主机密钥询问（窗口重新加载之前发出、错过了事件的询问） */
export function pendingHostKeyPrompts(): Promise<HostKeyPrompt[]> {
  return call('connection.pendingHostKeyPrompts', undefined)
}

export function answerHostKey(promptId: string, accept: boolean): Promise<void> {
  return call('connection.answerHostKey', { promptId, accept })
}

/** 条目中引用该连接的数量（sftp URI 的 connectionId 一致；分组没有 URI） */
export function countConnectionReferences(
  entries: readonly Pick<WorkspaceEntry, 'uri'>[],
  connectionId: string
): number {
  let n = 0
  for (const e of entries) {
    if (e.uri !== null && parseSftpUri(e.uri)?.connectionId === connectionId) n += 1
  }
  return n
}

/** 所有工作区中引用该连接的条目数（删除确认框用；逐个工作区读取条目） */
export async function fetchConnectionReferenceCount(connectionId: string): Promise<number> {
  const workspaces = await call('workspace.list', undefined)
  const lists = await Promise.all(workspaces.map((w) => call('entry.list', { workspaceId: w.id })))
  return lists.reduce((sum, entries) => sum + countConnectionReferences(entries, connectionId), 0)
}
