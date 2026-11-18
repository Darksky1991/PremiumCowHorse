import { QueryClient } from '@tanstack/react-query'
import type { Settings } from '@pch/shared'
import { subscribe } from './ipc'
import { queryKeys } from './query-keys'

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // 数据来自本机主进程：不需要窗口聚焦重取，变化由主进程事件推送
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
    }),
    // 被监听目录的内容变化：重新列出该目录
    subscribe('vfs.changed', ({ uri }) => {
      void client.invalidateQueries({ queryKey: queryKeys.directory(uri) })
    })
  ]
  return () => offs.forEach((off) => off())
}
