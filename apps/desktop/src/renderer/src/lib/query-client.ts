import { QueryClient, focusManager } from '@tanstack/react-query'
import type { Settings } from '@pch/shared'
import { subscribe } from './ipc'
import { queryKeys } from './query-keys'

type FocusSetup = Parameters<typeof focusManager.setEventListener>[0]

/**
 * TanStack Query 的 focusManager 默认只监听 visibilitychange（query-core focusManager.ts）：
 * Electron 中 Alt+Tab 切到其他窗口再回来时页面一直可见，不会触发。这里同时监听 focus。
 * 回调不带参数：由 focusManager 按 document.visibilityState 判断是否聚焦。
 */
export function focusListenerSetup(target: EventTarget): FocusSetup {
  return (handleFocus) => {
    const listener = (): void => handleFocus()
    target.addEventListener('focus', listener)
    target.addEventListener('visibilitychange', listener)
    return () => {
      target.removeEventListener('focus', listener)
      target.removeEventListener('visibilitychange', listener)
    }
  }
}

export function createQueryClient(): QueryClient {
  if (typeof window !== 'undefined') focusManager.setEventListener(focusListenerSetup(window))
  return new QueryClient({
    defaultOptions: {
      queries: {
        // 数据来自本机主进程，变化由主进程事件推送：默认不在聚焦时重新获取、永不过期。
        // 目录列表例外（未展开的目录不在监听中），在 data/vfs.ts 的 directoryQuery 中单独开启
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
