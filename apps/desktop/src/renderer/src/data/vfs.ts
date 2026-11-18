import { useEffect, useRef } from 'react'
import { useQueries } from '@tanstack/react-query'
import {
  AppError,
  VFS_WATCH_MAX,
  type ErrorCode,
  type FileEntry,
  type IpcChannel,
  type IpcInput,
  type IpcOutput
} from '@pch/shared'
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

/** 与 lib/ipc 的 call 同签名，测试可注入假实现 */
export type Invoke = <C extends IpcChannel>(channel: C, input: IpcInput<C>) => Promise<IpcOutput<C>>

/**
 * 列出一个目录。同一 URI 用固定的 requestId（dir:<uri>），新请求会取代主进程中未完成的旧请求。
 * signal 中止（TanStack Query 取消查询）时同步发送 vfs.cancel，主进程停止 lstat、释放线程池。
 * 中止只会发生在新请求发出之前（见 directoryQuery），且请求结束后移除监听器，
 * 因此这里的取消不会落到之后同一 requestId 的新请求上。
 */
export async function listDirectory(
  uri: string,
  signal: AbortSignal,
  invoke: Invoke = call
): Promise<FileEntry[]> {
  const requestId = `dir:${uri}`
  const onAbort = (): void => {
    void invoke('vfs.cancel', { requestId }).catch(() => undefined)
  }
  signal.addEventListener('abort', onAbort, { once: true })
  try {
    return await invoke('vfs.list', { uri, requestId })
  } finally {
    signal.removeEventListener('abort', onAbort)
  }
}

/**
 * 目录列表的新鲜期：在此之内重新挂载 / 聚焦不重新列出（节流快速折叠展开与频繁切换窗口），
 * 超过后重新挂载（再次展开、切回侧栏视图或工作区）与窗口重新获得焦点时重新列出。
 * 全局默认 staleTime 为 Infinity（其他数据由主进程事件推送），目录列表单独设置：
 * 未展开 / 不在当前工作区的目录不在监听中，期间的变化只能靠重新挂载时重新列出发现。
 */
export const DIRECTORY_STALE_MS = 2000

export interface DirectoryQueryOptions {
  queryKey: ReturnType<typeof queryKeys.directory>
  queryFn: (context: { signal: AbortSignal }) => Promise<FileEntry[]>
  staleTime: number
  refetchOnMount: boolean
  refetchOnWindowFocus: boolean
  refetchInterval: number | false
}

/**
 * 一个目录的查询选项。取消：TanStack Query 在以下时机中止 signal，均在同一 key 的新请求
 * 发出之前同步发生——最后一个观察者离开（折叠、切换工作区，revert 回请求前的状态）、
 * 有数据时被新的获取取代（invalidate / refetch 的 cancelRefetch）、resetQueries（重试）、
 * 缓存回收；被取消的请求随后以 FS_CANCELLED 结束，TanStack Query 不把它记为错误。
 * UNC 路径在 remote.pollIntervalSec > 0 时按该间隔轮询。
 */
export function directoryQuery(
  uri: string,
  pollSec: number,
  invoke: Invoke = call
): DirectoryQueryOptions {
  return {
    queryKey: queryKeys.directory(uri),
    queryFn: ({ signal }: { signal: AbortSignal }) => listDirectory(uri, signal, invoke),
    staleTime: DIRECTORY_STALE_MS,
    refetchOnMount: true,
    // 只对目录查询开启；聚焦事件来源见 lib/query-client.ts 的 focusManager 设置
    refetchOnWindowFocus: true,
    refetchInterval: pollSec > 0 && isNetworkUri(uri) ? pollSec * 1000 : (false as const)
  }
}

/** 列出一组目录（每个目录的选项见 directoryQuery） */
export function useDirectories(uris: string[]): Map<string, DirectoryState> {
  const pollSec = useSetting('remote.pollIntervalSec') ?? 0
  const results = useQueries({
    queries: uris.map((uri) => directoryQuery(uri, pollSec))
  })

  const map = new Map<string, DirectoryState>()
  uris.forEach((uri, i) => {
    const r = results[i]
    if (r) map.set(uri, directoryState(r))
  })
  return map
}

/**
 * 一个目录查询的结果 → 树使用的状态。
 * 错误优先于数据：TanStack Query 在重新获取失败时保留上一次的 data，若先看 data，
 * 展开中被删除 / 断开的目录会一直显示旧列表（vfs.changed、F5 都无效），而不是「找不到」等错误行。
 */
export function directoryState(r: {
  data: FileEntry[] | undefined
  isError: boolean
  error: unknown
}): DirectoryState {
  if (r.isError) {
    return { status: 'error', code: r.error instanceof AppError ? r.error.code : 'UNKNOWN' }
  }
  if (r.data !== undefined) return { status: 'ready', items: r.data }
  return { status: 'loading' }
}

/**
 * 需要监听的目录：只取列表已就绪的目录（列目录仍用全部已展开的目录）。
 * 出错 / 加载中的目录不监听：目录被删除后从监听集合中移除，原路径重建后「重试」使列表恢复为
 * 就绪，集合随之变化并重新发送 vfs.watch，监听得以重建（若一直留在集合中，集合不变就不会重发）。
 */
export function watchableUris(
  uris: readonly string[],
  directories: ReadonlyMap<string, DirectoryState>
): string[] {
  return uris.filter((uri) => directories.get(uri)?.status === 'ready')
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

/**
 * 防抖与「失效后重建」的判定逻辑；与 React 无关，便于单元测试。
 * 集合超过 vfs.watch 的上限（VFS_WATCH_MAX）时截断为前面的部分（调用方按树中自上而下的顺序给出）
 * 并警告：超过上限的调用会被主进程的输入校验整次拒绝，所有监听都会静默失效。
 */
export function createWatchScheduler(
  send: (uris: string[]) => void,
  delayMs: number = WATCH_DEBOUNCE_MS,
  warn: (message: string) => void = (message) => console.warn(message)
): WatchScheduler {
  let current: string[] = []
  let timer: ReturnType<typeof setTimeout> | undefined

  const schedule = (): void => {
    if (timer !== undefined) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = undefined
      if (current.length > VFS_WATCH_MAX) {
        warn(
          `[vfs.watch] ${current.length} directories requested; only the first ${VFS_WATCH_MAX} are watched`
        )
        send(current.slice(0, VFS_WATCH_MAX))
      } else {
        send(current)
      }
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
    const scheduler = createWatchScheduler(
      (set) => {
        void call('vfs.watch', { uris: set }).catch(() => undefined)
      },
      WATCH_DEBOUNCE_MS,
      // 控制台与 main.log 各记一条
      (message) => {
        console.warn(message)
        void call('log.write', { level: 'warn', message }).catch(() => undefined)
      }
    )
    schedulerRef.current = scheduler
    const off = subscribe('vfs.changed', ({ uri }) => scheduler.notifyChanged(uri))
    return () => {
      off()
      scheduler.dispose()
      schedulerRef.current = null
    }
  }, [])

  // 以内容而非引用判断集合是否变化；保持调用方的顺序（超过上限时保留靠前的目录）
  const key = JSON.stringify([...new Set(uris)])
  useEffect(() => {
    schedulerRef.current?.set(JSON.parse(key) as string[])
  }, [key])
}
