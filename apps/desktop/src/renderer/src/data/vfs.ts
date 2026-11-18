import { useEffect, useRef } from 'react'
import { useQueries } from '@tanstack/react-query'
import { AppError, type ErrorCode, type FileEntry } from '@pch/shared'
import { call, subscribe } from '@renderer/lib/ipc'
import { queryKeys } from '@renderer/lib/query-keys'
import { useSetting } from './settings'

export type DirectoryState =
  | { status: 'loading' }
  | { status: 'error'; code: ErrorCode }
  | { status: 'ready'; items: FileEntry[] }

/** 带主机名的 file URI（UNC 路径）视为网络位置；映射盘符被视为本地 */
export function isNetworkUri(uri: string): boolean {
  try {
    const u = new URL(uri)
    return u.protocol === 'file:' && u.hostname !== ''
  } catch {
    return false
  }
}

/**
 * 列出一组目录。同一 URI 用固定的 requestId（dir:<uri>），新请求会取代主进程中未完成的旧请求。
 * 窗口重新获得焦点时刷新（用 'always'：全局默认 staleTime 为 Infinity，只写 true 不会触发）；
 * UNC 路径在 remote.pollIntervalSec > 0 时按该间隔轮询。
 */
export function useDirectories(uris: string[]): Map<string, DirectoryState> {
  const pollSec = useSetting('remote.pollIntervalSec') ?? 0
  const results = useQueries({
    queries: uris.map((uri) => ({
      queryKey: queryKeys.directory(uri),
      queryFn: () => call('vfs.list', { uri, requestId: `dir:${uri}` }),
      refetchOnWindowFocus: 'always' as const,
      refetchInterval: pollSec > 0 && isNetworkUri(uri) ? pollSec * 1000 : (false as const)
    }))
  })

  const map = new Map<string, DirectoryState>()
  uris.forEach((uri, i) => {
    const r = results[i]
    if (!r) return
    if (r.data !== undefined) map.set(uri, { status: 'ready', items: r.data })
    else if (r.isError) {
      map.set(uri, {
        status: 'error',
        code: r.error instanceof AppError ? r.error.code : 'UNKNOWN'
      })
    } else map.set(uri, { status: 'loading' })
  })
  return map
}

const WATCH_DEBOUNCE_MS = 200

export interface WatchScheduler {
  /** 设置期望的监听集合（防抖后发送） */
  set(uris: string[]): void
  /** 收到 vfs.changed：若该目录在当前集合中，防抖后重发完整集合（主进程在监听失效时会移除该条目） */
  notifyChanged(uri: string): void
  /** 取消待发送的防抖并立即发送空集合 */
  dispose(): void
}

/** 防抖与「失效后重建」的判定逻辑；与 React 无关，便于单元测试 */
export function createWatchScheduler(
  send: (uris: string[]) => void,
  delayMs: number = WATCH_DEBOUNCE_MS
): WatchScheduler {
  let current: string[] = []
  let timer: ReturnType<typeof setTimeout> | undefined

  const schedule = (): void => {
    if (timer !== undefined) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = undefined
      send(current)
    }, delayMs)
  }

  return {
    set(uris) {
      current = uris
      schedule()
    },
    notifyChanged(uri) {
      if (current.includes(uri)) schedule()
    },
    dispose() {
      if (timer !== undefined) clearTimeout(timer)
      timer = undefined
      current = []
      send([])
    }
  }
}

/** 把当前需要监听的目录集合同步给主进程；卸载时清空 */
export function useWatchDirectories(uris: string[]): void {
  const schedulerRef = useRef<WatchScheduler | null>(null)

  useEffect(() => {
    const scheduler = createWatchScheduler((set) => {
      void call('vfs.watch', { uris: set }).catch(() => undefined)
    })
    schedulerRef.current = scheduler
    const off = subscribe('vfs.changed', ({ uri }) => scheduler.notifyChanged(uri))
    return () => {
      off()
      scheduler.dispose()
      schedulerRef.current = null
    }
  }, [])

  // 以内容而非引用判断集合是否变化
  const key = JSON.stringify([...new Set(uris)].sort())
  useEffect(() => {
    schedulerRef.current?.set(JSON.parse(key) as string[])
  }, [key])
}
