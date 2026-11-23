import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
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

/** onMutate 的上下文：本次 patch 涉及的键在写入前的值，与写入的乐观值 */
export interface SettingsMutationContext {
  previous: SettingsPatch
  optimistic: SettingsPatch
}

const sameValue = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)

/**
 * 乐观合并与按键回滚（导出供单测）：
 * - onMutate 把 patch 合并进缓存，记下这些键写入前的值；缓存尚未加载时不做任何事。
 * - onError 只还原本次 patch 涉及的键，且仅当缓存中该键仍等于本次的乐观值时才还原：
 *   之后又有写入（乐观值已被覆盖）或 settings.changed 广播到达的键保持现状，其他键不动。
 */
export function settingsMutationHandlers(client: QueryClient): {
  onMutate: (patch: SettingsPatch) => SettingsMutationContext
  onError: (
    error: Error,
    patch: SettingsPatch,
    context: SettingsMutationContext | undefined
  ) => void
} {
  return {
    onMutate: (patch) => {
      const cached = client.getQueryData<Settings>(queryKeys.settings)
      if (!cached) return { previous: {}, optimistic: {} }
      const previous: Record<string, unknown> = {}
      for (const key of Object.keys(patch)) previous[key] = (cached as Record<string, unknown>)[key]
      client.setQueryData<Settings>(queryKeys.settings, { ...cached, ...patch })
      return { previous: previous as SettingsPatch, optimistic: { ...patch } }
    },
    onError: (_error, _patch, context) => {
      if (!context) return
      client.setQueryData<Settings>(queryKeys.settings, (current) => {
        if (!current) return current
        const next: Record<string, unknown> = { ...current }
        for (const key of Object.keys(context.optimistic)) {
          const value = (current as Record<string, unknown>)[key]
          if (sameValue(value, (context.optimistic as Record<string, unknown>)[key])) {
            next[key] = (context.previous as Record<string, unknown>)[key]
          }
        }
        return next as Settings
      })
    }
  }
}

/** 写入设置：主进程保存后会广播 settings.changed，缓存由 query-client 的桥接更新 */
export function useUpdateSettings(): UseMutationResult<
  void,
  Error,
  SettingsPatch,
  SettingsMutationContext
> {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (patch: SettingsPatch) => call('settings.set', patch),
    ...settingsMutationHandlers(client)
  })
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
