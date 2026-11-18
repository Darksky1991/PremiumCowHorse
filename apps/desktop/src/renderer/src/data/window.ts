import { useQuery } from '@tanstack/react-query'
import type { WindowState } from '@pch/shared'
import { call } from '@renderer/lib/ipc'
import { queryKeys } from '@renderer/lib/query-keys'

/** 当前窗口的状态；最大化 / 还原后由主进程事件更新缓存（见 lib/query-client.ts） */
export function useWindowState(): WindowState {
  const { data } = useQuery({
    queryKey: queryKeys.windowState,
    queryFn: () => call('window.getState', undefined)
  })
  return data ?? { maximized: false }
}
