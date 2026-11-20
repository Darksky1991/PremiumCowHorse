import { useEffect, useState } from 'react'
import { sniffResource } from '@renderer/data/doc'

/** 判断结果：text / binary / empty；failed = 读取失败（交给 fallback 插件） */
export type SniffResult = 'text' | 'binary' | 'empty' | 'failed'

/**
 * needed 时对 uri 调用 vfs.sniff 一次（读开头 8KB），结果在使用它的组件存续期间缓存
 * （PreviewContainer 按位置重建标签内容：同一位置内不重复判断）。未判断完时为 undefined
 */
export function useSniff(uri: string, needed: boolean): SniffResult | undefined {
  const [result, setResult] = useState<{ uri: string; kind: SniffResult } | null>(null)
  const known = result?.uri === uri ? result.kind : undefined

  useEffect(() => {
    if (!needed || known !== undefined) return
    let cancelled = false
    sniffResource(uri).then(
      (kind) => {
        if (!cancelled) setResult({ uri, kind })
      },
      () => {
        if (!cancelled) setResult({ uri, kind: 'failed' })
      }
    )
    return () => {
      cancelled = true
    }
  }, [uri, needed, known])

  return known
}
