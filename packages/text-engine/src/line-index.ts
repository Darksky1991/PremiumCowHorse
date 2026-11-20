// 增量稀疏行索引（设计 3.2 节）：对一个字节窗口按顺序喂入字节，统计行数并记录检查点
// 「行号 → 行首字节偏移」。只保存检查点，1 亿行约 10 万个（< 1MB）。
import { findNewline, isNewlinePair } from './newline'
import type { NewlineUnit } from './types'

export interface LineIndexOptions {
  unit: NewlineUnit
  /** 行号为其倍数时记录检查点；默认 1000 */
  checkpointLines?: number
  /** 行首距上一个检查点超过该字节数时记录检查点；默认 1MB */
  checkpointBytes?: number
}

const DEFAULT_CHECKPOINT_LINES = 1000
const DEFAULT_CHECKPOINT_BYTES = 1_048_576

const assertCount = (name: string, value: number, min: number): void => {
  if (!Number.isSafeInteger(value) || value < min) {
    throw new RangeError(`LineIndex: ${name} must be an integer >= ${min}, got ${value}`)
  }
}

export class LineIndex {
  readonly windowStart: number
  readonly unit: NewlineUnit
  private readonly everyLines: number
  private readonly everyBytes: number
  // 检查点：两个数组按行号升序，下标相同的元素为一对；第 0 行（窗口起点）总是检查点
  private readonly cpLines: number[] = [0]
  private readonly cpOffsets: number[]
  /** 以换行结束的行数 */
  private confirmed = 0
  /** 尚未遇到换行的当前行的起点 */
  private lineStart: number
  private to: number
  private done = false
  /** 最后喂入的字节：UTF-16 的换行单元跨两次 feed 时使用 */
  private lastByte = -1

  constructor(windowStart: number, options: LineIndexOptions) {
    assertCount('windowStart', windowStart, 0)
    this.everyLines = options.checkpointLines ?? DEFAULT_CHECKPOINT_LINES
    this.everyBytes = options.checkpointBytes ?? DEFAULT_CHECKPOINT_BYTES
    assertCount('checkpointLines', this.everyLines, 1)
    assertCount('checkpointBytes', this.everyBytes, 1)
    this.windowStart = windowStart
    this.unit = options.unit
    this.cpOffsets = [windowStart]
    this.lineStart = windowStart
    this.to = windowStart
  }

  /** 已确定的行数：以换行结束的行；finish 后再加上末尾无换行的部分 */
  get lines(): number {
    return this.confirmed + (this.done && this.lineStart < this.to ? 1 : 0)
  }

  /** 已索引到的位置（文件中的绝对偏移，不含） */
  get indexedTo(): number {
    return this.to
  }

  get complete(): boolean {
    return this.done
  }

  /** 喂入从 offset 开始的字节；offset 必须等于 indexedTo（按顺序、不重叠、不留空隙） */
  feed(chunk: Uint8Array, offset: number): void {
    if (this.done) throw new Error('LineIndex: already finished; call reopen() before feeding')
    if (offset !== this.to) {
      throw new RangeError(`LineIndex: feed offset ${offset} must equal indexedTo ${this.to}`)
    }
    if (chunk.length === 0) return
    const unit = this.unit
    if (unit === 'byte') {
      for (let p = chunk.indexOf(0x0a); p >= 0; p = chunk.indexOf(0x0a, p + 1)) {
        this.newline(offset + p + 1)
      }
    } else {
      // 单元相对窗口起点对齐；aligned 为本块中单元起点下标的奇偶（不用位运算：偏移可能超过 2^31）
      const aligned = ((offset - this.windowStart) % 2) as 0 | 1
      if (aligned === 1 && isNewlinePair(this.lastByte, chunk[0]!, unit)) this.newline(offset + 1)
      for (let p = findNewline(chunk, 0, unit, aligned); p >= 0;) {
        this.newline(offset + p + 2)
        p = findNewline(chunk, p + 2, unit, aligned)
      }
    }
    this.lastByte = chunk[chunk.length - 1]!
    this.to = offset + chunk.length
  }

  /** 结束索引；windowEnd 必须等于 indexedTo。末尾无换行的部分计为一行 */
  finish(windowEnd: number): void {
    if (windowEnd !== this.to) {
      throw new RangeError(`LineIndex: finish(${windowEnd}) must equal indexedTo ${this.to}`)
    }
    this.done = true
  }

  /** 追加前调用：末行若无换行，重新视为未完成（追加的字节会延长它） */
  reopen(): void {
    this.done = false
  }

  /** 行号 ≤ line 的最近检查点 */
  checkpointFor(line: number): { line: number; offset: number } {
    if (!Number.isSafeInteger(line) || line < 0) {
      throw new RangeError(`LineIndex: invalid line ${line}`)
    }
    // 二分查找最后一个 cpLines[i] ≤ line
    let lo = 0
    let hi = this.cpLines.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >>> 1
      if (this.cpLines[mid]! <= line) lo = mid
      else hi = mid - 1
    }
    return { line: this.cpLines[lo]!, offset: this.cpOffsets[lo]! }
  }

  /** 遇到换行：下一行从 nextStart 开始 */
  private newline(nextStart: number): void {
    const line = ++this.confirmed
    this.lineStart = nextStart
    const lastOffset = this.cpOffsets[this.cpOffsets.length - 1]!
    if (line % this.everyLines === 0 || nextStart - lastOffset > this.everyBytes) {
      this.cpLines.push(line)
      this.cpOffsets.push(nextStart)
    }
  }
}
