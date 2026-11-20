import { AppError, type FileEntry, type FileStat } from '@pch/shared'
import { toAppError } from './errors'
import type { FileSystemProvider } from './types'

const DEFAULT_TIMEOUT_MS = 30_000

/**
 * 按 URI 的 scheme 路由到 provider，并统一处理取消与超时（一次性调用：stat、条目添加时的校验、
 * 扫描进程不可用时的直接枚举）。目录的持续刷新由扫描进程负责（设计 4.1），这里不监听。
 * 调用与中止信号赛跑：即使 provider 不响应信号（例如无响应的网络共享上的 readdir），
 * 调用也会按时以 FS_CANCELLED / FS_TIMEOUT 结束。
 */
export class VfsService {
  private readonly providers = new Map<string, FileSystemProvider>()
  private readonly requests = new Map<string, AbortController>()
  private readonly timeoutMs: (uri: string) => number

  constructor(
    providers: FileSystemProvider[],
    opts: {
      /**
       * 超时（毫秒，整次调用的总时长）：固定值，或按 URI 取（组合根按位置取 vfs.timeoutSec.*）。
       * 默认 30 秒
       */
      timeoutMs?: number | ((uri: string) => number)
    } = {}
  ) {
    for (const p of providers) this.providers.set(`${p.scheme}:`, p)
    const t = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.timeoutMs = typeof t === 'number' ? () => t : t
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

  /**
   * 读取文件的一段（provider 的 read：开-读-关）。超时同 stat / list（按位置）；
   * signal 由调用方持有（例如文档关闭时中止索引中的读取）
   */
  read(uri: string, offset: number, length: number, signal?: AbortSignal): Promise<Uint8Array> {
    return this.run(uri, undefined, (p, url, s) => p.read(url, offset, length, s), signal)
  }

  /**
   * 打开文件并返回读取流。超时（按位置）只覆盖「打开」阶段；之后的读取由调用方控制：
   * 流结束 / 出错 / destroy 时 provider 关闭句柄，external 中止时这里销毁流。
   * 若流在调用已超时 / 已取消之后才打开完成，立即销毁（不泄漏句柄）。
   */
  async createReadStream(
    uri: string,
    range?: { start: number; end: number },
    signal?: AbortSignal
  ): Promise<NodeJS.ReadableStream> {
    let settled = false
    let stream: NodeJS.ReadableStream
    try {
      stream = await this.run(
        uri,
        undefined,
        async (p, url, s) => {
          const opened = await p.createReadStream(url, range, s)
          // 调用已超时 / 已取消（run 已抛错）后才打开完成：没有人会接收这个流，立即销毁
          if (settled) destroyStream(opened)
          return opened
        },
        signal
      )
    } finally {
      settled = true
    }
    if (signal) {
      const onAbort = (): void => destroyStream(stream)
      if (signal.aborted) onAbort()
      else {
        signal.addEventListener('abort', onAbort, { once: true })
        stream.once('close', () => signal.removeEventListener('abort', onAbort))
      }
    }
    return stream
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
    op: (provider: FileSystemProvider, url: URL, signal: AbortSignal) => Promise<T>,
    external?: AbortSignal
  ): Promise<T> {
    const url = URL.canParse(uri) ? new URL(uri) : null
    if (!url) throw new AppError({ code: 'FS_INVALID_URI', detail: uri })
    const provider = this.providers.get(url.protocol)
    if (!provider) throw new AppError({ code: 'FS_UNSUPPORTED_SCHEME', detail: url.protocol })

    const controller = new AbortController()
    // 调用方的信号：中止时以同样的原因中止本次调用（已中止则立即结束）
    const forward = (): void => controller.abort(external?.reason)
    if (external?.aborted) forward()
    else external?.addEventListener('abort', forward, { once: true })
    if (requestId !== undefined) {
      // 同一 id 的新请求取代旧请求（例如重新列出同一目录）
      this.requests.get(requestId)?.abort()
      this.requests.set(requestId, controller)
    }
    const timer = setTimeout(
      () => controller.abort(new AppError({ code: 'FS_TIMEOUT', detail: uri })),
      this.timeoutMs(uri)
    )
    const aborted = new Promise<never>((_, reject) => {
      const signal = controller.signal
      if (signal.aborted) reject(signal.reason)
      else signal.addEventListener('abort', () => reject(signal.reason), { once: true })
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
      external?.removeEventListener('abort', forward)
      if (requestId !== undefined && this.requests.get(requestId) === controller) {
        this.requests.delete(requestId)
      }
    }
  }
}

function destroyStream(stream: NodeJS.ReadableStream): void {
  const s = stream as Partial<{ destroy(): void }>
  s.destroy?.()
}
