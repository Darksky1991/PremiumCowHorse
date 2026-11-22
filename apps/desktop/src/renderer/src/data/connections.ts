import { useMemo } from 'react'
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

/** connectionId → 连接名（显示路径 lib/display-path.ts 用）；列表未加载时为空 */
export function connectionNamesOf(
  list: readonly Pick<ConnectionDto, 'id' | 'name'>[] | undefined
): Record<string, string> {
  return Object.fromEntries((list ?? []).map((c) => [c.id, c.name]))
}

/** 当前的连接名表（引用在连接列表不变时稳定） */
export function useConnectionNames(): Record<string, string> {
  const { data } = useConnections()
  return useMemo(() => connectionNamesOf(data), [data])
}

/**
 * 保存连接。**不经 TanStack 的 MutationCache**：useMutation 会把 variables（含明文 secret / sudoSecret）
 * 留在缓存中直到 gcTime（默认 5 分钟）到期。明文只在这次 IPC 调用中经过渲染端，返回后不留任何引用；
 * 进行中状态由调用方自己保存。成功后主进程广播 connection.changed
 */
export function saveConnection(input: ConnectionSaveInput): Promise<ConnectionDto> {
  return call('connection.save', input)
}

/** 以下操作的输入只有连接 id（不含机密），可以经 useMutation */
export interface ConnectionActions {
  remove: UseMutationResult<void, Error, string>
  test: UseMutationResult<ConnectionTestResult, Error, string>
  reconnect: UseMutationResult<void, Error, string>
  trustHostKey: UseMutationResult<void, Error, string>
}

/** 写操作成功后主进程广播 connection.changed，列表由 query-client 的桥接失效 */
export function useConnectionActions(): ConnectionActions {
  const remove = useMutation({ mutationFn: (id: string) => call('connection.delete', { id }) })
  const test = useMutation({ mutationFn: (id: string) => call('connection.test', { id }) })
  const reconnect = useMutation({
    mutationFn: (id: string) => call('connection.reconnect', { id })
  })
  const trustHostKey = useMutation({
    mutationFn: (id: string) => call('connection.trustHostKey', { id })
  })
  return { remove, test, reconnect, trustHostKey }
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

/** 订阅「询问已结束」（主进程中已回答或超时），返回取消订阅函数 */
export function subscribeHostKeyPromptsClosed(listener: (promptId: string) => void): () => void {
  return subscribe('connection.hostKeyPromptClosed', ({ promptId }) => listener(promptId))
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
