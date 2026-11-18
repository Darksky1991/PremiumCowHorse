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
    })
  ]
  return () => offs.forEach((off) => off())
}
