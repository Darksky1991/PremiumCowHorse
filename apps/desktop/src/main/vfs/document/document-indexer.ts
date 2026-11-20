// 单个文档的后台索引任务（设计 3.1 节）：按 1MB 分块读取窗口（每块一次开-读-关）、喂给 LineIndex、
// 节流报告进度、可取消；窗口终点在刷新时可能增长（追加），每块之前重新取得。
import { AppError } from '@pch/shared'
import type { LineIndex } from '@pch/text-engine'
import { toAppError } from '../errors'
import type { Utf8Validator, Utf8Violation } from './utf8-validator'

/** 索引的分块大小（本地与网络位置相同） */
export const INDEX_CHUNK_BYTES = 1024 * 1024

export interface IndexJob {
  index: LineIndex
  /** 当前窗口终点（不含）：每块之前重新取得，刷新发现追加时由文档更新 */
  end(): number
  read(offset: number, length: number, signal: AbortSignal): Promise<Uint8Array>
  /**
   * 全量模式、自动判断为 UTF-8（非 BOM）时对内容继续做 UTF-8 校验；发现非法字节后不再校验。
   * 文档可在任务进行中把它设为 undefined（例如用户手动指定了编码）
   */
  utf8?: Utf8Validator
  onInvalidUtf8(violation: Utf8Violation): void
  /** 进度（节流由调用方处理）：final 为 true 表示本次运行结束（完成或出错） */
  onProgress(final: boolean, error?: string): void
}

/** complete：索引到窗口终点并 finish；shrunk：读到的字节比窗口少（文件在 stat 之后变短） */
export type IndexOutcome = 'complete' | 'shrunk'

export class DocumentIndexer {
  private controller: AbortController | null = null

  constructor(private readonly job: IndexJob) {}

  /** 正在运行（同步更新：结束的那一刻起即为 false，刷新可据此决定是否重新开始） */
  get active(): boolean {
    return this.controller !== null
  }

  /**
   * 开始一次运行（已在运行时返回 null）。索引已完成时先 reopen（追加的字节会延长末行）。
   * 出错时以 AppError 拒绝并已报告 final 进度；被 stop 时以 FS_CANCELLED 拒绝、不报告
   */
  start(): Promise<IndexOutcome> | null {
    if (this.controller) return null
    const controller = new AbortController()
    this.controller = controller
    if (this.job.index.complete) this.job.index.reopen()
    return this.run(controller.signal)
  }

  stop(): void {
    this.controller?.abort()
    this.controller = null
  }

  private async run(signal: AbortSignal): Promise<IndexOutcome> {
    const { job } = this
    const { index } = job
    try {
      for (;;) {
        throwIfStopped(signal)
        const pos = index.indexedTo
        const end = job.end()
        if (pos >= end) {
          // 与上面的 end() 之间没有 await：刷新不会在这之间延长窗口而被漏掉
          index.finish(end)
          this.release(signal)
          job.onProgress(true)
          return 'complete'
        }
        const want = Math.min(INDEX_CHUNK_BYTES, end - pos)
        const read = await job.read(pos, want, signal)
        throwIfStopped(signal)
        // 只取计划的长度：文件在扫描中增长也不会越过窗口终点（增长部分由刷新发现）
        const chunk = read.length > want ? read.subarray(0, want) : read
        if (chunk.length > 0) {
          index.feed(chunk, pos)
          this.checkUtf8(chunk, pos)
        }
        if (chunk.length < want) {
          this.release(signal)
          return 'shrunk'
        }
        job.onProgress(false)
      }
    } catch (e) {
      const error = toAppError(e)
      this.release(signal)
      if (!signal.aborted) job.onProgress(true, error.code)
      throw error
    }
  }

  /** 本次运行结束：同步清除，使 active 立即为 false */
  private release(signal: AbortSignal): void {
    if (this.controller?.signal === signal) this.controller = null
  }

  private checkUtf8(chunk: Uint8Array, pos: number): void {
    const violation = this.job.utf8?.feed(chunk, pos)
    if (!violation) return
    this.job.utf8 = undefined
    this.job.onInvalidUtf8(violation)
  }
}

function throwIfStopped(signal: AbortSignal): void {
  if (signal.aborted) throw new AppError({ code: 'FS_CANCELLED' })
}
