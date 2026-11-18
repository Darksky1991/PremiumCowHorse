import { AppError, type FileEntry, type FileStat } from '@pch/shared'
import { toAppError } from './errors'
import type { FileSystemProvider } from './types'

const DEFAULT_TIMEOUT_MS = 30_000
const DEFAULT_WATCH_DEBOUNCE_MS = 300
const DEFAULT_WATCH_RETRY_BACKOFF_MS = 60_000

interface WatchEntry {
  handle: { close(): void }
  owners: Set<number>
  timer?: ReturnType<typeof setTimeout>
}

/**
 * 按 URI 的 scheme 路由到 provider，并统一处理取消与超时。
 * 调用与中止信号赛跑：即使 provider 不响应信号（例如无响应的网络共享上的 readdir），
 * 调用也会按时以 FS_CANCELLED / FS_TIMEOUT 结束。
 */
export class VfsService {
  private readonly providers = new Map<string, FileSystemProvider>()
  private readonly requests = new Map<string, AbortController>()
  private readonly timeoutMs: number
  private readonly watchDebounceMs: number
  private readonly onDirectoryChanged?: (uri: string) => void
  private readonly watchRetryBackoffMs: number
  /** 以 URI 字符串为 key 的活动监听（按 owner 引用计数） */
  private readonly watches = new Map<string, WatchEntry>()
  /** 各 owner 期望监听的 URI（含退避中、暂未建立监听的 URI） */
  private readonly ownerUris = new Map<number, Set<string>>()
  /** 监听自行失效的 URI → 失效时刻；退避期内 setWatched 不重建 */
  private readonly failedAt = new Map<string, number>()

  constructor(
    providers: FileSystemProvider[],
    opts: {
      timeoutMs?: number
      onDirectoryChanged?: (uri: string) => void
      watchDebounceMs?: number
      /** 监听自行失效后，同一 URI 在多长时间内不重建（默认 60 秒） */
      watchRetryBackoffMs?: number
    } = {}
  ) {
    for (const p of providers) this.providers.set(`${p.scheme}:`, p)
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.watchDebounceMs = opts.watchDebounceMs ?? DEFAULT_WATCH_DEBOUNCE_MS
    this.watchRetryBackoffMs = opts.watchRetryBackoffMs ?? DEFAULT_WATCH_RETRY_BACKOFF_MS
    this.onDirectoryChanged = opts.onDirectoryChanged
  }

  /** 进行中的可取消请求数（诊断用） */
  get pending(): number {
    return this.requests.size
  }

  stat(uri: string, requestId?: string): Promise<FileStat> {
    return this.run(uri, requestId, (p, url, signal) => p.stat(url, signal))
  }

  list(uri: string, requestId?: string): Promise<FileEntry[]> {
    return this.run(uri, requestId, (p, url, signal) => p.list(url, signal))
  }

  /** 取消进行中的请求；未知或已结束的 id 不做任何事 */
  cancel(requestId: string): void {
    this.requests.get(requestId)?.abort()
  }

  /**
   * 以集合替换某 owner（窗口）的监听目录；同一 URI 在多个 owner 间共享一个监听。
   * 不支持监听的 scheme、无法解析的 URI 静默忽略。
   * 监听自行失效的 URI 进入退避：仍留在集合中的期间（例如目录还在、只是位置不支持变更通知），
   * 退避结束前的 setWatched 不重建，避免「重建 → 报错 → 重建」的循环；一旦它离开所有 owner 的
   * 集合（例如列表出错后被渲染端移出），退避记录清除，再次加入时立即重建（删除后重建 → 重试）。
   */
  setWatched(ownerId: number, uris: string[]): void {
    const next = new Set(uris)
    const prev = this.ownerUris.get(ownerId) ?? new Set<string>()
    for (const uri of prev) if (!next.has(uri)) this.unwatch(ownerId, uri)
    const kept = new Set<string>()
    for (const uri of next) if (this.watch(ownerId, uri)) kept.add(uri)
    if (kept.size > 0) this.ownerUris.set(ownerId, kept)
    else this.ownerUris.delete(ownerId)
    for (const uri of prev) if (!next.has(uri) && !this.isDesired(uri)) this.failedAt.delete(uri)
  }

  releaseOwner(ownerId: number): void {
    this.setWatched(ownerId, [])
  }

  async dispose(): Promise<void> {
    for (const c of this.requests.values()) c.abort()
    this.requests.clear()
    for (const entry of this.watches.values()) this.closeEntry(entry)
    this.watches.clear()
    this.ownerUris.clear()
    this.failedAt.clear()
    await Promise.all([...this.providers.values()].map((p) => p.dispose()))
  }

  /**
   * 让 owner 期望监听 uri。返回 false = 不可监听（不留在集合中）；
   * 退避中或建立后立即失效时返回 true（保留期望状态，供退避判定与之后的重建）。
   */
  private watch(ownerId: number, uri: string): boolean {
    const existing = this.watches.get(uri)
    if (existing) {
      existing.owners.add(ownerId)
      return true
    }
    const url = URL.canParse(uri) ? new URL(uri) : null
    const provider = url && this.providers.get(url.protocol)
    if (!url || !provider?.watch) return false
    const failed = this.failedAt.get(uri)
    if (failed !== undefined) {
      if (Date.now() - failed < this.watchRetryBackoffMs) return true
      this.failedAt.delete(uri)
    }
    // 退避期间仍期望该 URI 的其他 owner 一并计入引用，避免本 owner 释放时关闭他们仍需要的监听
    const owners = new Set([ownerId])
    for (const [id, set] of this.ownerUris) if (set.has(uri)) owners.add(id)
    const entry: WatchEntry = { handle: { close: () => undefined }, owners }
    // 先登记再调用 provider：provider 可能在 watch 返回前同步报告失效
    this.watches.set(uri, entry)
    // 同一 URI 在防抖窗口内的多次变化合并为一次回调
    entry.handle = provider.watch(
      url,
      () => {
        clearTimeout(entry.timer)
        entry.timer = setTimeout(() => {
          entry.timer = undefined
          this.onDirectoryChanged?.(uri)
        }, this.watchDebounceMs)
      },
      () => this.invalidate(uri, entry)
    )
    return true
  }

  /**
   * provider 报告监听已失效：移除监听条目并记录失效时刻（退避）；各 owner 的期望集合保持不变。
   * 不取消待触发的通知。
   */
  private invalidate(uri: string, entry: WatchEntry): void {
    if (this.watches.get(uri) !== entry) return
    this.watches.delete(uri)
    this.failedAt.set(uri, Date.now())
  }

  private isDesired(uri: string): boolean {
    for (const set of this.ownerUris.values()) if (set.has(uri)) return true
    return false
  }

  private unwatch(ownerId: number, uri: string): void {
    const entry = this.watches.get(uri)
    if (!entry) return
    entry.owners.delete(ownerId)
    if (entry.owners.size === 0) {
      this.closeEntry(entry)
      this.watches.delete(uri)
    }
  }

  private closeEntry(entry: WatchEntry): void {
    clearTimeout(entry.timer)
    entry.handle.close()
  }

  private async run<T>(
    uri: string,
    requestId: string | undefined,
    op: (provider: FileSystemProvider, url: URL, signal: AbortSignal) => Promise<T>
  ): Promise<T> {
    const url = URL.canParse(uri) ? new URL(uri) : null
    if (!url) throw new AppError({ code: 'FS_INVALID_URI', detail: uri })
    const provider = this.providers.get(url.protocol)
    if (!provider) throw new AppError({ code: 'FS_UNSUPPORTED_SCHEME', detail: url.protocol })

    const controller = new AbortController()
    if (requestId !== undefined) {
      // 同一 id 的新请求取代旧请求（例如重新列出同一目录）
      this.requests.get(requestId)?.abort()
      this.requests.set(requestId, controller)
    }
    const timer = setTimeout(
      () => controller.abort(new AppError({ code: 'FS_TIMEOUT', detail: uri })),
      this.timeoutMs
    )
    const aborted = new Promise<never>((_, reject) => {
      controller.signal.addEventListener('abort', () => reject(controller.signal.reason), {
        once: true
      })
    })
    const operation = op(provider, url, controller.signal)
    // 中止先于操作结束时，操作稍后的失败无人等待：吞掉它，避免 unhandled rejection
    operation.catch(() => undefined)
    try {
      return await Promise.race([operation, aborted])
    } catch (e) {
      throw toAppError(e)
    } finally {
      clearTimeout(timer)
      if (requestId !== undefined && this.requests.get(requestId) === controller) {
        this.requests.delete(requestId)
      }
    }
  }
}
