import type { QueryClient } from '@tanstack/react-query'
import { SETTINGS_MUTATION_KEY } from '@renderer/data/settings'

/**
 * 监听设置写入的失败：每次失败（经 useUpdateSettings 发起的写入）调用一次 onError。
 * data 层不能 import stores（分层规则），所以不在 useUpdateSettings 里直接 notify，
 * 而是由 feature 订阅 MutationCache（按 mutationKey 过滤），所有调用方（设置页、选择器记住视图…）共用
 */
export function startSettingsWriteWatch(
  client: QueryClient,
  onError: (error: unknown) => void
): () => void {
  const key = JSON.stringify(SETTINGS_MUTATION_KEY)
  return client.getMutationCache().subscribe((event) => {
    if (event.type !== 'updated' || event.action.type !== 'error') return
    if (JSON.stringify(event.mutation.options.mutationKey) !== key) return
    onError(event.action.error)
  })
}
