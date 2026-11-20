// 一个打开的文本文档（设计 3.1、3.4、3.6 节）：窗口与模式、编码、行索引、刷新。
// 不持有文件句柄：每次读取都经 read（provider 的开-读-关）。改变状态的操作（刷新、切换编码、建立全量索引、
// 建索引中发现非法 UTF-8 后的重新判断）按顺序执行；readLines 不排队。
import {
  AppError,
  type DocChangedEvent,
  type DocLineBlock,
  type DocProgressEvent,
  type DocumentInfo,
  type FileStat,
  type Language
} from '@pch/shared'
import {
  LineIndex,
  readLines,
  sniff,
  SAMPLE_BYTES,
  unitOf,
  type EncodingLabel,
  type ReadAt
} from '@pch/text-engine'
import {
  detectAround,
  detectInWindow,
  FILE_HEAD_BYTES,
  manualEncoding,
  probeEncoding,
  type EncodingState
} from './document-encoding'
import { HEAD_BYTES, judgeChange, type FileSnapshot } from './document-identity'
import { DocumentIndexer, type IndexJob } from './document-indexer'
import { alignWindow, planWindow, type WindowPlan } from './document-window'
import { Utf8Validator, type Utf8Violation } from './utf8-validator'

export interface TextDocumentDeps {
  stat(uri: string): Promise<FileStat>
  read(uri: string, offset: number, length: number, signal?: AbortSignal): Promise<Uint8Array>
  /** 自动建立完整行索引的上限（字节，preview.maxTextSizeMB） */
  fullIndexLimitBytes(): number
  /** 编码判断平局时的偏好（当前界面语言） */
  preferredLanguage(): Language
  now(): number
  progressIntervalMs: number
  emitProgress(event: Omit<DocProgressEvent, 'docId'>): void
  emitChanged(event: Omit<DocChangedEvent, 'docId'>): void
}

export interface OpenOptions {
  /** 手动指定的编码 */
  encoding?: EncodingLabel
  /** 部分模式取开头还是末尾（默认开头） */
  at?: 'start' | 'end'
}

const ignore = (): void => undefined

export class TextDocument {
  private snapshot!: FileSnapshot
  /** 文件开头 FILE_HEAD_BYTES（不超过 stat 的大小）：BOM、sniff 与第一个样本 */
  private fileHead!: Uint8Array
  private layout!: WindowPlan
  private encoding!: EncodingState
  private binary = false
  private index!: LineIndex
  private job!: IndexJob
  private indexer: DocumentIndexer | null = null
  private manualLabel: EncodingLabel | null
  /** doc.buildIndex 之后：之后的重建也按全量 */
  private forceFull = false
  /** 最近一次刷新时文件不存在 */
  private missing = false
  private closed = false
  private lastProgress = -Infinity
  /** 当前索引任务的第一块读完（或任务结束）：open 等它，见 open 的说明 */
  private firstChunk: Promise<void> = Promise.resolve()
  private queue: Promise<unknown> = Promise.resolve()
  /** 关闭时中止进行中的读取 */
  private readonly lifetime = new AbortController()
  private readonly readAt: ReadAt

  private constructor(
    readonly id: string,
    readonly uri: string,
    private readonly at: 'start' | 'end',
    manual: EncodingLabel | undefined,
    private readonly deps: TextDocumentDeps
  ) {
    this.manualLabel = manual ?? null
    this.readAt = (offset, length) => deps.read(uri, offset, length, this.lifetime.signal)
  }

  /**
   * stat → 读开头 → 决定窗口与编码 → 开始后台索引，等第一块（1MB）索引完再返回：
   * 1MB 以内的文件返回时索引已完成；之后的 doc.progress 需要再次读取文件，晚于 doc.open 的应答到达渲染端
   * （渲染端在应答之前不知道 docId，更早的事件会被丢弃）
   */
  static async open(
    id: string,
    uri: string,
    options: OpenOptions,
    deps: TextDocumentDeps
  ): Promise<TextDocument> {
    const doc = new TextDocument(id, uri, options.at ?? 'start', options.encoding, deps)
    await doc.load(await deps.stat(uri))
    await doc.firstChunk
    return doc
  }

  info(): DocumentInfo {
    const { layout, encoding, index } = this
    return {
      docId: this.id,
      uri: this.uri,
      size: this.snapshot.size,
      mtime: this.snapshot.mtime,
      encoding: {
        label: encoding.label,
        confidence: encoding.confidence,
        bomLength: layout.start === 0 ? encoding.bomLength : 0,
        manual: encoding.manual
      },
      binary: this.binary,
      mode: layout.mode,
      window: { start: layout.start, end: layout.end },
      index: { lines: index.lines, complete: index.complete, indexedTo: index.indexedTo }
    }
  }

  /** 窗口内第 start 行起的 count 行（不超过已确定的行数；count 的上限由 IPC 校验） */
  readLines(start: number, count: number): Promise<DocLineBlock> {
    return readLines(this.index, this.readAt, start, count)
  }

  refresh(): Promise<void> {
    return this.serial(() => this.refreshNow(false))
  }

  /** 手动指定编码（null = 自动判断）。换行单元改变（切换到 / 离开 UTF-16）时重新对齐窗口并重建索引 */
  setEncoding(label: EncodingLabel | null): Promise<void> {
    return this.serial(async () => {
      const unit = unitOf(this.encoding.label)
      this.manualLabel = label
      this.encoding = label
        ? manualEncoding(label, this.fileHead)
        : await detectInWindow(
            this.layout,
            this.fileHead,
            this.readAt,
            this.deps.preferredLanguage()
          )
      if (unitOf(this.encoding.label) !== unit) await this.relayout()
      else if (!this.verifiesUtf8()) this.job.utf8 = undefined
    })
  }

  /** 部分 → 全量：重新读取并对整个文件建立索引 */
  buildIndex(): Promise<void> {
    return this.serial(async () => {
      if (this.layout.mode === 'full') return
      this.forceFull = true
      await this.load(await this.deps.stat(this.uri))
    })
  }

  close(): void {
    this.closed = true
    this.indexer?.stop()
    this.lifetime.abort()
  }

  /** 重新读取文件开头，决定窗口、编码并重建索引（打开、reset、buildIndex） */
  private async load(stat: FileStat): Promise<void> {
    const head = await this.readAt(0, FILE_HEAD_BYTES)
    this.fileHead = head.subarray(0, Math.min(head.length, stat.size))
    this.snapshot = {
      size: stat.size,
      mtime: stat.mtime,
      head: this.headOf(this.fileHead, stat.size)
    }
    this.binary = sniff(this.fileHead).kind === 'binary'
    const plan = this.plan(stat.size)
    // 对齐窗口需要换行单元：手动指定 / BOM / 计划起点处能否判为 UTF-16
    const probe =
      this.manualLabel ??
      probeEncoding(
        this.fileHead,
        plan.start === 0 ? this.fileHead : await this.readAt(plan.start, SAMPLE_BYTES)
      )
    let layout = await alignWindow(plan, stat.size, unitOf(probe), this.readAt)
    const encoding = this.manualLabel
      ? manualEncoding(this.manualLabel, this.fileHead)
      : await detectInWindow(layout, this.fileHead, this.readAt, this.deps.preferredLanguage())
    if (unitOf(encoding.label) !== unitOf(probe)) {
      layout = await alignWindow(plan, stat.size, unitOf(encoding.label), this.readAt)
    }
    this.layout = layout
    this.encoding = encoding
    this.startIndex()
  }

  /** 编码的换行单元改变后：按当前大小重新计划并对齐窗口，重建索引（不重新判断编码） */
  private async relayout(): Promise<void> {
    const size = this.snapshot.size
    this.layout = await alignWindow(this.plan(size), size, unitOf(this.encoding.label), this.readAt)
    this.startIndex()
  }

  private plan(size: number): WindowPlan {
    return this.forceFull
      ? { mode: 'full', start: 0, end: size }
      : planWindow(size, this.deps.fullIndexLimitBytes(), this.at)
  }

  private headOf(bytes: Uint8Array, size: number): Uint8Array {
    return bytes.slice(0, Math.min(HEAD_BYTES, size, bytes.length))
  }

  /**
   * 刷新（设计 3.6）：stat 与开头 4KB → 不存在 missing / 截断或开头变化 reset / 只增长 appended。
   * afterShrink：扫描中发现文件变短后的检查；此时不重新开始索引（避免读取持续变短时反复重试）
   */
  private async refreshNow(afterShrink: boolean): Promise<void> {
    const now = await this.statAndHead()
    const change = judgeChange(this.snapshot, now?.snapshot ?? null)
    if (!now) {
      // 只在变为不存在时通知一次（渲染端按间隔自动刷新）
      if (!this.missing) this.deps.emitChanged({ missing: true })
      this.missing = true
      return
    }
    // 不存在之后又出现：不论内容是否相同都重建（渲染端借 reset 离开「文件已不存在」）
    if (change === 'reset' || this.missing) {
      this.missing = false
      await this.load(now.stat)
      this.deps.emitChanged({ reset: true })
      return
    }
    if (change === 'appended') {
      // 窗口终点就是此前的文件末尾（全量、末尾窗口）才随之延长；开头窗口不受影响
      const followsEnd = this.layout.end === this.snapshot.size
      this.snapshot = {
        ...now.snapshot,
        head: this.snapshot.head.length < HEAD_BYTES ? now.snapshot.head : this.snapshot.head
      }
      if (!followsEnd) return
      this.layout = { ...this.layout, end: now.stat.size }
      if (!afterShrink) this.ensureIndexing()
      this.deps.emitChanged({ appended: true })
      return
    }
    if (!afterShrink) this.ensureIndexing()
  }

  /** stat 与开头字节；文件不存在为 null */
  private async statAndHead(): Promise<{ stat: FileStat; snapshot: FileSnapshot } | null> {
    try {
      const stat = await this.deps.stat(this.uri)
      const head = await this.readAt(0, HEAD_BYTES)
      return {
        stat,
        snapshot: { size: stat.size, mtime: stat.mtime, head: this.headOf(head, stat.size) }
      }
    } catch (e) {
      if (e instanceof AppError && e.code === 'FS_NOT_FOUND') return null
      throw e
    }
  }

  /** 新的行索引与索引任务（窗口或换行单元改变时） */
  private startIndex(): void {
    this.indexer?.stop()
    if (this.closed) return
    const index = new LineIndex(this.layout.start, { unit: unitOf(this.encoding.label) })
    let firstChunkDone = ignore
    this.firstChunk = new Promise<void>((resolve) => (firstChunkDone = resolve))
    const job: IndexJob = {
      index,
      end: () => this.layout.end,
      read: (offset, length, signal) => this.deps.read(this.uri, offset, length, signal),
      utf8: this.verifiesUtf8() ? new Utf8Validator() : undefined,
      onInvalidUtf8: (violation) => {
        this.serial(() => this.redetect(violation, job)).catch(ignore)
      },
      onProgress: (final, error) => {
        firstChunkDone()
        this.progress(index, final, error)
      }
    }
    this.index = index
    this.job = job
    this.indexer = new DocumentIndexer(job)
    this.lastProgress = -Infinity
    this.runIndexer()?.finally(firstChunkDone).catch(ignore)
  }

  /** 索引未完成或窗口已延长时继续（出错后的重试、追加） */
  private ensureIndexing(): void {
    if (!this.index.complete || this.layout.end > this.index.indexedTo) this.runIndexer()
  }

  /** 开始一次索引运行（已在运行时不做任何事）；返回本次运行结束的时刻 */
  private runIndexer(): Promise<void> | null {
    const indexer = this.indexer
    const run = indexer?.start()
    if (!run) return null
    return run.then((outcome) => {
      // 读到的比窗口少：文件变短了 → 检查（通常为 reset）
      if (outcome === 'shrunk' && this.indexer === indexer) {
        this.serial(() => this.refreshNow(true)).catch(ignore)
      }
    }, ignore) // 失败已经由 doc.progress 的 error 报告；刷新时重试
  }

  /** 全量模式、自动判断为 UTF-8 且不是 BOM 确定的：建索引时继续校验全部内容 */
  private verifiesUtf8(): boolean {
    const { encoding } = this
    return (
      this.layout.mode === 'full' &&
      !encoding.manual &&
      encoding.label === 'utf-8' &&
      encoding.confidence !== 'certain'
    )
  }

  /** 建索引时发现非法 UTF-8：用含该处的样本重新判断；结果改变时 reset */
  private async redetect(violation: Utf8Violation, job: IndexJob): Promise<void> {
    const stale = (): boolean => job !== this.job || this.encoding.manual
    if (stale()) return
    const encoding = await detectAround(
      this.layout,
      violation,
      this.fileHead,
      this.readAt,
      this.deps.preferredLanguage()
    )
    if (stale()) return
    const before = this.encoding
    if (encoding.label === before.label && encoding.confidence === before.confidence) return
    this.encoding = encoding
    // 旧编码之间换行单元相同，索引照用；万一判为 UTF-16 则重建
    if (unitOf(encoding.label) !== unitOf(before.label)) await this.relayout()
    this.deps.emitChanged({ reset: true })
  }

  private progress(index: LineIndex, final: boolean, error?: string): void {
    if (index !== this.index || this.closed) return
    const now = this.deps.now()
    if (!final && now - this.lastProgress < this.deps.progressIntervalMs) return
    this.lastProgress = now
    this.deps.emitProgress({
      indexedTo: index.indexedTo,
      lines: index.lines,
      complete: index.complete,
      ...(error ? { error } : {})
    })
  }

  private serial<T>(op: () => Promise<T>): Promise<T> {
    const run = this.queue.then(() => {
      if (this.closed) throw new AppError({ code: 'DOC_NOT_FOUND', detail: this.id })
      return op()
    })
    this.queue = run.catch(ignore)
    return run
  }
}
