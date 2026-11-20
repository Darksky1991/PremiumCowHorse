import { useEffect } from 'react'
import { useQueries, useQuery, type QueryClient, type UseQueryResult } from '@tanstack/react-query'
import {
  AppError,
  VFS_INTEREST_TABS_MAX,
  VFS_REFRESH_MAX,
  type DirectoryListing,
  type ErrorCode,
  type FileEntry,
  type FileStat,
  type Interest,
  type IpcChannel,
  type IpcInput,
  type IpcOutput
} from '@pch/shared'
import { call } from '@renderer/lib/ipc'
import { queryKeys } from '@renderer/lib/query-keys'

/**
 * 树使用的目录状态。ready 时带上扫描进程给出的 state（fresh：刚确认过；cached：缓存内容、
 * 检查已安排；offline：所在共享断开）与上次检查的时刻（没有记录时为 null）。
 */
export type DirectoryState =
  | { status: 'loading' }
  | { status: 'error'; code: ErrorCode }
  | {
      status: 'ready'
      items: FileEntry[]
      state: DirectoryListing['state']
      checkedAt: number | null
    }

/** 与 lib/ipc 的 call 同签名，测试可注入假实现 */
export type Invoke = <C extends IpcChannel>(channel: C, input: IpcInput<C>) => Promise<IpcOutput<C>>

/**
 * 列出一个目录。同一 URI 用固定的 requestId（dir:<uri>）：扫描进程不可用、主进程直接枚举时，
 * 新请求会取代未完成的旧请求；signal 中止（TanStack Query 取消查询）时同步发送 vfs.cancel。
 * 中止只会发生在新请求发出之前（见 directoryQuery），且请求结束后移除监听器，
 * 因此这里的取消不会落到之后同一 requestId 的新请求上。经扫描进程的请求不可取消（很快返回缓存）。
 */
export async function listDirectory(
  uri: string,
  signal: AbortSignal,
  invoke: Invoke = call
): Promise<DirectoryListing> {
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

export interface DirectoryQueryOptions {
  queryKey: ReturnType<typeof queryKeys.directory>
  queryFn: (context: { signal: AbortSignal }) => Promise<DirectoryListing>
  staleTime: number
  refetchOnMount: boolean
  refetchOnWindowFocus: boolean
}

/**
 * 一个目录的查询选项。目录的新鲜度由扫描进程负责（缓存 + 按优先级检查，设计 4.8）：
 * 内容有变化时主进程广播 vfs.changed，lib/query-client.ts 让该查询失效。因此
 * staleTime 为 Infinity、聚焦时不重新获取（窗口焦点由主进程的窗口事件告知扫描进程）、没有轮询。
 * refetchOnMount 保持 true：staleTime 为 Infinity 时它只对「已失效」的查询生效——
 * 折叠期间收到 vfs.changed 的目录（非活动查询只被标记失效），再次展开时重新列出。
 *
 * 取消：TanStack Query 在以下时机中止 signal，均在同一 key 的新请求发出之前同步发生——
 * 最后一个观察者离开（折叠、切换工作区）、有数据时被新的获取取代（invalidate 的 cancelRefetch）、
 * 缓存回收；被取消的请求随后以 FS_CANCELLED 结束，TanStack Query 不把它记为错误。
 */
export function directoryQuery(uri: string, invoke: Invoke = call): DirectoryQueryOptions {
  return {
    queryKey: queryKeys.directory(uri),
    queryFn: ({ signal }: { signal: AbortSignal }) => listDirectory(uri, signal, invoke),
    staleTime: Infinity,
    refetchOnMount: true,
    refetchOnWindowFocus: false
  }
}

/** 文件标签的 stat 的新鲜期：在此之内切换回标签不再 stat（主进程的 stat 占用 libuv 线程池，knowledge/electron.md） */
const STAT_STALE_MS = 5000

/** 单个资源的 stat 的查询选项（见 useResourceStat） */
export function statQuery(
  uri: string,
  invoke: Invoke = call
): {
  queryKey: ReturnType<typeof queryKeys.stat>
  queryFn: () => Promise<FileStat>
  staleTime: number
} {
  return {
    queryKey: queryKeys.stat(uri),
    queryFn: () => invoke('vfs.stat', { uri }),
    staleTime: STAT_STALE_MS
  }
}

/**
 * 文件标签的 stat（文件信息）。目录标签不 stat（PreviewContainer 用标签的类型与标题，
 * 状态由目录列表表现）。挂载（切换到该标签）时超过新鲜期（5 秒）才重新取得；
 * 所在目录的 vfs.changed 也让它失效（lib/query-client.ts）。enabled 为 false 时不发出
 * （所在共享断开：stat 会等到超时）
 */
export function useResourceStat(uri: string, enabled = true): UseQueryResult<FileStat> {
  return useQuery({ ...statQuery(uri), enabled })
}

/** 一次性取得目录列表（与资源树共用同一查询的缓存；已失效时重新列出） */
export function fetchDirectory(client: QueryClient, uri: string): Promise<DirectoryListing> {
  return client.fetchQuery(directoryQuery(uri))
}

/** 列出一组目录（每个目录的选项见 directoryQuery） */
export function useDirectories(uris: string[]): Map<string, DirectoryState> {
  const results = useQueries({ queries: uris.map((uri) => directoryQuery(uri)) })

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
  data: DirectoryListing | undefined
  isError: boolean
  error: unknown
}): DirectoryState {
  if (r.isError) {
    return { status: 'error', code: r.error instanceof AppError ? r.error.code : 'UNKNOWN' }
  }
  if (r.data !== undefined) {
    return {
      status: 'ready',
      items: r.data.items,
      state: r.data.state,
      checkedAt: r.data.checkedAt
    }
  }
  return { status: 'loading' }
}

/** 当前显示中（有观察者）的目录查询的 URI，即树中所有已展开的目录 */
function activeDirectoryUris(client: QueryClient): string[] {
  return client
    .getQueryCache()
    .findAll({ queryKey: queryKeys.directoryRoot, type: 'active' })
    .map((q) => q.queryKey[2])
    .filter((uri): uri is string => typeof uri === 'string')
}

/** vfs.refresh 按上限分批；失败不影响之后的重新列出 */
async function sendRefresh(uris: string[], invoke: Invoke): Promise<void> {
  for (let i = 0; i < uris.length; i += VFS_REFRESH_MAX) {
    await invoke('vfs.refresh', { uris: uris.slice(i, i + VFS_REFRESH_MAX) }).catch(() => undefined)
  }
}

/**
 * F5 / 刷新按钮：让扫描进程立即检查所有已展开的目录（P0，断开的共享也尝试一次），
 * 再让所有目录查询失效（显示中的重新列出，其余只标记失效）。
 */
export async function refreshDirectories(
  client: QueryClient,
  invoke: Invoke = call
): Promise<void> {
  await sendRefresh(activeDirectoryUris(client), invoke)
  // 不等待重新列出完成（结果经查询状态反映到树上）
  void client.invalidateQueries({ queryKey: queryKeys.directoryRoot })
}

/** 状态行的「重试」：立即检查该目录，再让该查询重新获取 */
export async function retryDirectory(
  client: QueryClient,
  uri: string,
  invoke: Invoke = call
): Promise<void> {
  await sendRefresh([uri], invoke)
  void client.invalidateQueries({ queryKey: queryKeys.directory(uri) })
}

/**
 * 从搜索结果定位时发现目录或文件已不在：让扫描进程立即确认该目录（设计 8.3，只读）。
 * 不让查询失效：确认发现变化时扫描进程广播 vfs.changed，查询随之重新列出
 */
export async function confirmDirectory(uri: string, invoke: Invoke = call): Promise<void> {
  await sendRefresh([uri], invoke)
}

const INTEREST_DEBOUNCE_MS = 300

/** 资源树给出的部分（关注点与视口内外的已展开目录） */
export type TreeInterest = Omit<Interest, 'tabs'>
const EMPTY_TREE: TreeInterest = { focus: null, visible: [], offscreen: [] }

export interface InterestSender {
  /** 设置当前关注点（防抖后发送；与上次发送的内容相同则不发送） */
  set(interest: Interest): void
}

/** vfs.interest 的防抖（滚动停止后发送，设计 4.6）；与 React 无关，便于单元测试 */
export function createInterestSender(
  send: (interest: Interest) => void,
  delayMs: number = INTEREST_DEBOUNCE_MS
): InterestSender {
  let timer: ReturnType<typeof setTimeout> | undefined
  let lastSent: string | null = null
  return {
    set(interest) {
      if (timer !== undefined) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = undefined
        const key = JSON.stringify(interest)
        if (key === lastSent) return
        lastSent = key
        send(interest)
      }, delayMs)
    }
  }
}

export interface InterestHub {
  /** 资源树的部分；资源树卸载时设为空 */
  setTree(tree: TreeInterest): void
  /** 标签中显示的目录（去重，超过 IPC 上限截断）；标签区卸载时设为空 */
  setTabs(tabs: readonly string[]): void
}

/**
 * 本窗口关注点的两个来源——资源树（features/explorer）与标签（features/tabs）——合并为一个
 * vfs.interest，经同一个防抖发送（主进程按窗口整体替换，两个来源各发一次会互相覆盖）。
 * 一个来源卸载只清空自己的部分：侧栏切到搜索视图时，标签中的目录仍是关注点。
 */
export function createInterestHub(
  send: (interest: Interest) => void,
  delayMs: number = INTEREST_DEBOUNCE_MS
): InterestHub {
  const sender = createInterestSender(send, delayMs)
  let tree = EMPTY_TREE
  let tabs: string[] = []
  const flush = (): void => sender.set({ ...tree, tabs })
  return {
    setTree(next) {
      tree = next
      flush()
    },
    setTabs(next) {
      tabs = [...new Set(next)].slice(0, VFS_INTEREST_TABS_MAX)
      flush()
    }
  }
}

/** 本窗口唯一的合并器（首次使用时创建；发送失败忽略——下一次变化会再发送整体） */
let windowHub: InterestHub | null = null
const hub = (): InterestHub =>
  (windowHub ??= createInterestHub((i) => {
    void call('vfs.interest', i).catch(() => undefined)
  }))

/** 资源树的关注点与已展开目录同步给主进程（扫描进程据此调度）；卸载时清空这一部分 */
export function useVfsInterest(tree: TreeInterest): void {
  // 以内容而非引用判断是否变化
  const key = JSON.stringify(tree)
  useEffect(() => {
    hub().setTree(JSON.parse(key) as TreeInterest)
  }, [key])
  useEffect(() => () => hub().setTree(EMPTY_TREE), [])
}

/** 标签中显示的目录同步给主进程（按关注点处理）；卸载时清空这一部分 */
export function useVfsTabsInterest(tabs: readonly string[]): void {
  const key = JSON.stringify(tabs)
  useEffect(() => {
    hub().setTabs(JSON.parse(key) as string[])
  }, [key])
  useEffect(() => () => hub().setTabs([]), [])
}
