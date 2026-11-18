import { AppError, type FileEntry, type FileStat } from '@pch/shared'
import { toAppError } from './errors'
import type { FileSystemProvider } from './types'

const DEFAULT_TIMEOUT_MS = 30_000

/**
 * 按 URI 的 scheme 路由到 provider，并统一处理取消与超时。
 * 调用与中止信号赛跑：即使 provider 不响应信号（例如无响应的网络共享上的 readdir），
 * 调用也会按时以 FS_CANCELLED / FS_TIMEOUT 结束。
 */
export class VfsService {
  private readonly providers = new Map<string, FileSystemProvider>()
  private readonly requests = new Map<string, AbortController>()
  private readonly timeoutMs: number

  constructor(providers: FileSystemProvider[], opts: { timeoutMs?: number } = {}) {
    for (const p of providers) this.providers.set(`${p.scheme}:`, p)
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
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

  async dispose(): Promise<void> {
    for (const c of this.requests.values()) c.abort()
    this.requests.clear()
    await Promise.all([...this.providers.values()].map((p) => p.dispose()))
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
