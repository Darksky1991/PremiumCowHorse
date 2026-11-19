import {
  AppError,
  ScannerToMain,
  type DirectoryListing,
  type Interest,
  type MainToScanner,
  type OfflineShare,
  type ReachabilityEvent,
  type ScannerConfig,
  type SearchQuery,
  type SearchResult
} from '@pch/shared'
import type { Logger } from '../infra/logger'

/** 扫描进程的通信端口（生产环境为 UtilityProcess，测试中为假实现） */
export interface ScannerPort {
  postMessage(m: unknown): void
  on(event: 'message', cb: (m: unknown) => void): void
  on(event: 'exit', cb: (code: number) => void): void
  kill(): void
}

export interface ScannerClientOptions {
  fork: () => ScannerPort
  /** 缓存库文件，fork 后在第一条 init 消息中下发 */
  cacheFile: string
  onChanged: (uri: string) => void
  onReachability: (e: ReachabilityEvent) => void
  log: Logger
  /** restartWindowMs 内意外退出达到此次数即停止重启（降级模式），默认 3 */
  maxRestarts?: number
  /** 默认 5 分钟 */
  restartWindowMs?: number
  /** dispose 时等待进程自行退出的时长，超时则 kill；默认 2 秒 */
  shutdownTimeoutMs?: number
  /**
   * 请求的兜底超时：超过此时长没有结果即以 FS_TIMEOUT 拒绝（默认 60 秒）。
   * 扫描进程自身的超时（timeoutSec、排队的 P0 等待者）远短于此；这里只防扫描进程的事件循环卡住、
   * 结果消息丢失等情况让调用方永远等待。不用 INDEX_UNAVAILABLE：vfs.list 遇到它会回退到直接枚举，
   * 而扫描进程可能仍在同一共享上枚举（并发第二次访问）。
   */
  requestTimeoutMs?: number
  now?: () => number
}

interface Pending {
  resolve: (v: unknown) => void
  reject: (e: AppError) => void
  timer: ReturnType<typeof setTimeout>
}

interface OwnerState {
  focused?: boolean
  interest?: Interest
}

const unavailable = (detail: string): AppError =>
  new AppError({ code: 'INDEX_UNAVAILABLE', detail })

/**
 * 主进程侧的扫描进程客户端（设计 4.1）：请求按 id 对应结果；进程意外退出时以 INDEX_UNAVAILABLE
 * 拒绝进行中的请求并重启，重启后重发 init、最后一次配置与各窗口的焦点 / 关注点；
 * 短时间内连续退出则停止重启，available 变为 false（调用方退回直接枚举、不缓存的降级模式）。
 */
export class ScannerClient {
  private readonly maxRestarts: number
  private readonly windowMs: number
  private readonly shutdownTimeoutMs: number
  private readonly requestTimeoutMs: number
  private readonly now: () => number

  private port: ScannerPort | null = null
  private nextId = 1
  private readonly pending = new Map<number, Pending>()
  private lastConfig: ScannerConfig | null = null
  private readonly owners = new Map<number, OwnerState>()
  private exits: number[] = []
  private state: 'idle' | 'running' | 'unavailable' | 'disposed' = 'idle'
  private exited: (() => void) | null = null
  /** 进行中的搜索：渲染端的 requestId → 请求 id（同一 requestId 的新查询取代旧查询） */
  private readonly searches = new Map<string, number>()
  /** 当前断开的共享 → 断开时刻（随 reachability 事件维护；渲染端启动 / 重新加载时查询） */
  private readonly offline = new Map<string, number>()

  constructor(private readonly opts: ScannerClientOptions) {
    this.maxRestarts = opts.maxRestarts ?? 3
    this.windowMs = opts.restartWindowMs ?? 5 * 60_000
    this.shutdownTimeoutMs = opts.shutdownTimeoutMs ?? 2000
    this.requestTimeoutMs = opts.requestTimeoutMs ?? 60_000
    this.now = opts.now ?? Date.now
  }

  /** false：扫描进程不可用（超过重启上限或已 dispose） */
  get available(): boolean {
    return this.state === 'running'
  }

  start(): void {
    if (this.state !== 'idle') return
    this.state = 'running'
    this.spawn()
  }

  configure(c: ScannerConfig): void {
    this.lastConfig = c
    this.send({ type: 'configure', config: c })
  }

  list(uri: string): Promise<DirectoryListing> {
    return this.request<DirectoryListing>((id) => ({ type: 'list', id, uri }))
  }

  interest(ownerId: number, i: Interest): void {
    const interest = { focus: i.focus, visible: [...i.visible], offscreen: [...i.offscreen] }
    this.owner(ownerId).interest = interest
    this.send({ type: 'interest', ownerId, ...interest })
  }

  windowFocus(ownerId: number, focused: boolean): void {
    this.owner(ownerId).focused = focused
    this.send({ type: 'windowFocus', ownerId, focused })
  }

  releaseOwner(ownerId: number): void {
    this.owners.delete(ownerId)
    this.send({ type: 'releaseOwner', ownerId })
  }

  refresh(uris: string[]): void {
    this.send({ type: 'refresh', uris })
  }

  cacheInfo(): Promise<{ bytes: number }> {
    return this.request<{ bytes: number }>((id) => ({ type: 'cacheInfo', id }))
  }

  clearCache(): Promise<void> {
    return this.request<void>((id) => ({ type: 'clearCache', id }))
  }

  /**
   * 在缓存中搜索（只读缓存）。扫描进程中的 SQL 是同步执行的，无法中途打断，所以「取消」是
   * 丢弃结果：同一 requestId 的新查询、cancelSearch 都以 FS_CANCELLED 拒绝旧请求，
   * 扫描进程稍后返回的旧结果被忽略。
   */
  search(q: SearchQuery, requestId?: string): Promise<SearchResult> {
    if (requestId !== undefined) this.cancelSearch(requestId)
    const p = this.request<SearchResult>((id) => {
      if (requestId !== undefined) this.searches.set(requestId, id)
      return { type: 'search', id, ...q }
    })
    if (requestId === undefined) return p
    const mine = this.searches.get(requestId)
    const forget = (): void => {
      if (this.searches.get(requestId) === mine) this.searches.delete(requestId)
    }
    return p.then(
      (v) => (forget(), v),
      (e: unknown) => {
        forget()
        throw e
      }
    )
  }

  /** 取消该 requestId 的进行中的搜索（没有则忽略） */
  cancelSearch(requestId: string): void {
    const id = this.searches.get(requestId)
    if (id === undefined) return
    this.searches.delete(requestId)
    this.settle(id)?.reject(new AppError({ code: 'FS_CANCELLED' }))
  }

  /** 当前断开的共享（扫描进程报告 offline、尚未报告 online 的） */
  offlineShares(): OfflineShare[] {
    return [...this.offline].map(([share, since]) => ({ share, since }))
  }

  /** 请求扫描进程退出（关闭缓存库），超时则 kill；之后所有请求以 INDEX_UNAVAILABLE 拒绝 */
  async dispose(): Promise<void> {
    if (this.state === 'disposed') return
    const port = this.state === 'running' ? this.port : null
    this.state = 'disposed'
    this.rejectAll('scanner client disposed')
    if (!port) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const exited = new Promise<void>((resolve) => {
      this.exited = resolve
      timer = setTimeout(() => {
        this.opts.log.warn('[scanner] did not exit after shutdown; killing it')
        try {
          port.kill()
        } catch (e) {
          this.opts.log.error('[scanner] kill failed', e)
        }
        resolve()
      }, this.shutdownTimeoutMs)
    })
    this.post(port, { type: 'shutdown' })
    await exited
    clearTimeout(timer)
    this.port = null
  }

  // ---- 内部 ----

  private owner(ownerId: number): OwnerState {
    let o = this.owners.get(ownerId)
    if (!o) {
      o = {}
      this.owners.set(ownerId, o)
    }
    return o
  }

  private spawn(): void {
    let port: ScannerPort
    try {
      port = this.opts.fork()
    } catch (e) {
      this.opts.log.error('[scanner] fork failed', e)
      this.giveUp('fork failed')
      return
    }
    this.port = port
    port.on('message', (m) => {
      if (this.port === port) this.onMessage(m)
    })
    port.on('exit', (code) => this.onExit(port, code))
    this.post(port, { type: 'init', cacheFile: this.opts.cacheFile })
    if (this.lastConfig) this.post(port, { type: 'configure', config: this.lastConfig })
    for (const [ownerId, o] of this.owners) {
      if (o.focused !== undefined)
        this.post(port, { type: 'windowFocus', ownerId, focused: o.focused })
      if (o.interest) this.post(port, { type: 'interest', ownerId, ...o.interest })
    }
  }

  private onExit(port: ScannerPort, code: number): void {
    if (this.port !== port) return
    if (this.state === 'disposed') {
      this.exited?.()
      return
    }
    this.port = null
    this.rejectAll(`scanner exited (code ${code})`)
    this.resetReachability()
    const t = this.now()
    this.exits = [...this.exits.filter((x) => t - x < this.windowMs), t]
    if (this.exits.length >= this.maxRestarts) {
      this.giveUp(
        `exited ${this.exits.length} times within ${this.windowMs / 1000}s (last code ${code})`
      )
      return
    }
    this.opts.log.warn(`[scanner] exited unexpectedly (code ${code}); restarting`)
    this.spawn()
  }

  private giveUp(reason: string): void {
    this.state = 'unavailable'
    this.port = null
    this.rejectAll(`scanner unavailable: ${reason}`)
    this.resetReachability()
    this.opts.log.error(
      `[scanner] ${reason}; not restarting (degraded mode: directories are listed directly without the cache)`
    )
  }

  private onMessage(raw: unknown): void {
    const parsed = ScannerToMain.safeParse(raw)
    if (!parsed.success) {
      this.opts.log.warn(`[scanner] invalid message ignored: ${parsed.error.message.slice(0, 500)}`)
      // 结果消息无效但能读出 id：拒绝对应的请求，不让调用方等到兜底超时
      const id = resultId(raw)
      if (id !== null) this.settle(id)?.reject(unavailable('invalid result from the scanner'))
      return
    }
    const m = parsed.data
    switch (m.type) {
      case 'result': {
        const p = this.settle(m.id)
        if (!p) return
        if (m.ok) p.resolve(m.value)
        else p.reject(new AppError(m.error))
        return
      }
      case 'changed':
        return this.opts.onChanged(m.uri)
      case 'reachability':
        if (m.state === 'offline') this.offline.set(m.share, m.since)
        else this.offline.delete(m.share)
        return this.opts.onReachability({ share: m.share, state: m.state, since: m.since })
      case 'log':
        return this.opts.log[m.level](`[scanner] ${m.message}`)
      case 'ready':
        return this.opts.log.info('[scanner] ready')
    }
  }

  private request<T>(build: (id: number) => MainToScanner): Promise<T> {
    if (this.state !== 'running' || !this.port) {
      return Promise.reject(unavailable(`scanner is ${this.state}`))
    }
    const id = this.nextId++
    const port = this.port
    const message = build(id)
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!this.settle(id)) return
        this.opts.log.warn(
          `[scanner] ${message.type} #${id} got no result within ${this.requestTimeoutMs / 1000}s`
        )
        reject(
          new AppError({
            code: 'FS_TIMEOUT',
            detail: `no result from the scanner within ${this.requestTimeoutMs / 1000}s`
          })
        )
      }, this.requestTimeoutMs)
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer })
      if (!this.post(port, message)) {
        this.settle(id)
        reject(unavailable('cannot send to the scanner'))
      }
    })
  }

  /** 取出并移除进行中的请求（清除其兜底计时器）；未知或已结束的 id 返回 undefined */
  private settle(id: number): Pending | undefined {
    const p = this.pending.get(id)
    if (!p) return undefined
    this.pending.delete(id)
    clearTimeout(p.timer)
    return p
  }

  /** 不回应的消息：不可用时丢弃（重启后由 spawn 重发需要保持的状态） */
  private send(m: MainToScanner): void {
    if (this.state === 'running' && this.port) this.post(this.port, m)
  }

  private post(port: ScannerPort, m: MainToScanner): boolean {
    try {
      port.postMessage(m)
      return true
    } catch (e) {
      this.opts.log.error(`[scanner] cannot send ${m.type}`, e)
      return false
    }
  }

  /**
   * 扫描进程退出（将重启）或进入降级模式：断开状态由该进程的探测判定，随进程一起失效。
   * 对每个断开的共享发出 online 并清空（新进程若仍连不上会重新发出 offline；降级模式直接枚举）
   */
  private resetReachability(): void {
    const since = this.now()
    const shares = [...this.offline.keys()]
    this.offline.clear()
    for (const share of shares) this.opts.onReachability({ share, state: 'online', since })
  }

  private rejectAll(detail: string): void {
    const err = unavailable(detail)
    for (const p of this.pending.values()) {
      clearTimeout(p.timer)
      p.reject(err)
    }
    this.pending.clear()
  }
}

/** 未通过校验的消息若是 result 且带整数 id，返回该 id */
function resultId(raw: unknown): number | null {
  if (typeof raw !== 'object' || raw === null) return null
  const { type, id } = raw as { type?: unknown; id?: unknown }
  return type === 'result' && Number.isInteger(id) ? (id as number) : null
}
