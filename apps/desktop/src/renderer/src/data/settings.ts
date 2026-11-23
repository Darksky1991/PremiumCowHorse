import {
  useMutation,
  useQuery,
  useQueryClient,
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

/** 缓存占用（字节）：来自扫描进程，不可用（例如尚未启动）时查询失败，由调用方显示「取得できません」 */
export function useCacheInfo(): UseQueryResult<{ bytes: number }> {
  return useQuery({
    queryKey: queryKeys.cacheInfo,
    queryFn: () => call('vfs.cacheInfo', {}),
    retry: false
  })
}

/** 清空缓存（目录列表缓存与索引）；成功后重新读取占用 */
export function useClearCache(): UseMutationResult<void, Error, void> {
  const client = useQueryClient()
  return useMutation({
    mutationFn: () => call('vfs.clearCache', {}),
    onSettled: () => client.invalidateQueries({ queryKey: queryKeys.cacheInfo })
  })
}
