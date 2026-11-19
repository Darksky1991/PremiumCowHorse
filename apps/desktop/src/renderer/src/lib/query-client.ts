import { QueryClient } from '@tanstack/react-query'
import type { Settings } from '@pch/shared'
import { shareKeyOfUri } from './file-uri'
import { subscribe } from './ipc'
import { queryKeys } from './query-keys'

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // 数据来自本机主进程，变化由主进程事件推送：不在聚焦时重新获取、永不过期。
        // 目录列表同样如此：新鲜度由扫描进程负责，内容变化时经 vfs.changed 推送（data/vfs.ts）
        refetchOnWindowFocus: false,
        retry: false,
        staleTime: Infinity
      }
    }
  })
}

/**
 * 主进程事件 → 缓存更新的桥接，集中在这里。
 * 业务组件不直接订阅 IPC 事件。返回取消订阅函数。
 */
export function bridgeMainEvents(client: QueryClient): () => void {
  const offs = [
    subscribe('settings.changed', (patch) => {
      client.setQueryData<Settings>(queryKeys.settings, (prev) =>
        prev ? { ...prev, ...patch } : prev
      )
    }),
    subscribe('window.stateChanged', (state) => {
      client.setQueryData(queryKeys.windowState, state)
    }),
    // 工作区或其条目变化：工作区列表 / 当前工作区整体失效，对应工作区的条目失效
    subscribe('workspace.changed', ({ id }) => {
      void client.invalidateQueries({ queryKey: queryKeys.workspaceRoot })
      void client.invalidateQueries({ queryKey: queryKeys.entries(id) })
      void client.invalidateQueries({ queryKey: queryKeys.indexTargets(id) })
    }),
    // 目录的缓存内容有变化（扫描进程检查后发现差异）：重新列出该目录（读缓存，很快）
    subscribe('vfs.changed', ({ uri }) => {
      void client.invalidateQueries({ queryKey: queryKeys.directory(uri) })
    }),
    // 共享 / 卷恢复在线：该位置下的目录查询失效，显示中的重新列出（state 不再是 offline）。
    // 断开时不需要：之后的列出由扫描进程返回 offline
    subscribe('vfs.reachability', ({ share, state }) => {
      if (state !== 'online') return
      const key = share.toLowerCase()
      void client.invalidateQueries({
        queryKey: queryKeys.directoryRoot,
        predicate: (q) => {
          const uri = q.queryKey[2]
          return typeof uri === 'string' && shareKeyOfUri(uri)?.toLowerCase() === key
        }
      })
    })
  ]
  return () => offs.forEach((off) => off())
}
