import {
  useMutation,
  useQuery,
  type UseMutationResult,
  type UseQueryResult
} from '@tanstack/react-query'
import type { SettingKey, Settings, SettingsPatch } from '@pch/shared'
import { call } from '@renderer/lib/ipc'
import { queryKeys } from '@renderer/lib/query-keys'

export function useSettings(): UseQueryResult<Settings> {
  return useQuery({
    queryKey: queryKeys.settings,
    queryFn: () => call('settings.getAll', undefined)
  })
}

/** 读取单个设置项；设置尚未加载时返回 undefined */
export function useSetting<K extends SettingKey>(key: K): Settings[K] | undefined {
  return useSettings().data?.[key]
}

/** 写入设置：主进程保存后会广播 settings.changed，缓存由 query-client 的桥接更新 */
export function useUpdateSettings(): UseMutationResult<void, Error, SettingsPatch> {
  return useMutation({ mutationFn: (patch: SettingsPatch) => call('settings.set', patch) })
}
