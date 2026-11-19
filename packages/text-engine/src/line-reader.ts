// 按行读取（设计 3.3 节）：从 ≤ start 的最近检查点读起、跳到 start，返回 count 行的原始字节与行边界。
// 读取量有界：跳到 start 最多扫描一个检查点间隔（≤ checkpointLines 行或约 checkpointBytes）；
// 超过 maxLineBytes 的行只保留前缀，其后的下一行若离上一个检查点超过 checkpointBytes 则自身就是检查点，直接跳过去。
import { ChunkSource } from './chunk-source'
import type { LineIndex } from './line-index'
import { findNewline, isCarriageReturn, unitSize } from './newline'
import type { LineBlock, NewlineUnit, ReadAt } from './types'

const DEFAULT_MAX_BYTES = 4 * 1024 * 1024
const DEFAULT_MAX_LINE_BYTES = 65_536

export interface ReadLimits {
  /** 一次返回的字节总量上限（至少返回一行）；默认 4MB */
  maxBytes?: number
  /** 单行保留的字节上限，超过时截断；默认 65536（UTF-16 时向下取偶数） */
  maxLineBytes?: number
}

/** 读到的一行 */
interface ScannedLine {
  /** 保留的字节：未截断时含行尾，截断时为前 maxLineBytes 字节 */
  bytes: Uint8Array
  /** 内容长度（不含行尾） */
  length: number
  truncated: boolean
  /** 下一行的起点；截断且尚未找到行尾时为 null */
  next: number | null
  /** 已扫描到的位置：next 为 null 时从这里继续找行尾 */
  scannedTo: number
}

/** 读取窗口内第 start 行起的 count 行（不超过索引已确定的行数） */
export async function readLines(
  index: LineIndex,
  readAt: ReadAt,
  start: number,
  count: number,
  limits: ReadLimits = {}
): Promise<LineBlock> {
  for (const [name, value] of [
    ['start', start],
    ['count', count]
  ] as const) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new RangeError(`readLines: invalid ${name} ${value}`)
    }
  }
  const unit = index.unit
  const width = unitSize(unit)
  const maxBytes = limits.maxBytes ?? DEFAULT_MAX_BYTES
  const maxLineBytes = Math.max(
    width,
    alignDown(limits.maxLineBytes ?? DEFAULT_MAX_LINE_BYTES, width)
  )
  const end = Math.min(start + count, index.lines)
  const lines: ScannedLine[] = []
  if (start >= end) return assemble(start, lines)

  const source = new ChunkSource(readAt, index.indexedTo, width)
  const checkpoint = index.checkpointFor(start)
  let pos: number | null = checkpoint.offset
  for (let line = checkpoint.line; line < start && pos !== null; line++) {
    pos = await skipLine(source, pos, unit)
  }
  let total = 0
  for (let line = start; line < end && pos !== null; line++) {
    const scanned = await takeLine(source, pos, unit, maxLineBytes)
    if (!scanned) break
    if (lines.length > 0 && total + scanned.bytes.length > maxBytes) break
    lines.push(scanned)
    total += scanned.bytes.length
    if (line + 1 >= end) break
    pos =
      scanned.next ?? (await lineStartAfterTruncated(index, source, line + 1, scanned.scannedTo))
  }
  return assemble(start, lines)
}

const alignDown = (value: number, width: 1 | 2): number => value - (value % width)

/** 跳过从 pos 开始的一行，返回下一行的起点；读不到（文件变短、无换行）时为 null */
async function skipLine(
  source: ChunkSource,
  pos: number,
  unit: NewlineUnit
): Promise<number | null> {
  for (let at = pos; ;) {
    const chunk = await source.at(at)
    if (!chunk) return null
    const p = findNewline(chunk.bytes, at - chunk.base, unit)
    if (p >= 0) return chunk.base + p + unitSize(unit)
    at = chunk.base + chunk.bytes.length
  }
}

/** 截断行之后的下一行：有自己的检查点时直接跳过去，否则继续扫描找行尾（距检查点 ≤ checkpointBytes，有界） */
async function lineStartAfterTruncated(
  index: LineIndex,
  source: ChunkSource,
  line: number,
  scannedTo: number
): Promise<number | null> {
  const checkpoint = index.checkpointFor(line)
  if (checkpoint.line === line) return checkpoint.offset
  return skipLine(source, scannedTo, index.unit)
}

/** 读取从 pos 开始的一行：最多保留 maxLineBytes 的内容；读不到数据时为 null */
async function takeLine(
  source: ChunkSource,
  pos: number,
  unit: NewlineUnit,
  maxLineBytes: number
): Promise<ScannedLine | null> {
  const width = unitSize(unit)
  // 足以容纳 maxLineBytes 的内容与 \r\n；与 pos 同样对齐，换行单元不会跨过这个边界
  const cap = maxLineBytes + 2 * width
  const parts: Uint8Array[] = []
  let length = 0
  let at = pos
  while (at < source.limit) {
    const chunk = await source.at(at)
    if (!chunk) return null
    const from = at - chunk.base
    const to = Math.min(chunk.bytes.length, from + (cap - length))
    const p = findNewline(chunk.bytes.subarray(0, to), from, unit)
    if (p >= 0) {
      parts.push(chunk.bytes.subarray(from, p + width))
      length += p + width - from
      const raw = concat(parts, length)
      let content = length - width
      if (content >= width && isCarriageReturn(raw, content - width, unit)) content -= width
      return content > maxLineBytes
        ? truncatedLine(raw, maxLineBytes, pos + length, pos + length)
        : {
            bytes: raw,
            length: content,
            truncated: false,
            next: pos + length,
            scannedTo: pos + length
          }
    }
    parts.push(chunk.bytes.subarray(from, to))
    length += to - from
    at = chunk.base + to
    if (length >= cap) return truncatedLine(concat(parts, length), maxLineBytes, null, at)
  }
  if (length === 0) return null
  // 到达窗口终点仍无换行：finish 后末尾无换行的行
  const raw = concat(parts, length)
  return length > maxLineBytes
    ? truncatedLine(raw, maxLineBytes, at, at)
    : { bytes: raw, length, truncated: false, next: at, scannedTo: at }
}

const truncatedLine = (
  raw: Uint8Array,
  maxLineBytes: number,
  next: number | null,
  scannedTo: number
): ScannedLine => ({
  bytes: raw.subarray(0, maxLineBytes),
  length: maxLineBytes,
  truncated: true,
  next,
  scannedTo
})

function concat(parts: Uint8Array[], length: number): Uint8Array {
  if (parts.length === 1) return parts[0]!
  const out = new Uint8Array(length)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

function assemble(start: number, lines: ScannedLine[]): LineBlock {
  const bytes = new Uint8Array(lines.reduce((sum, line) => sum + line.bytes.length, 0))
  const block: LineBlock = { start, bytes, starts: [], ends: [], truncated: [] }
  let offset = 0
  lines.forEach((line, i) => {
    bytes.set(line.bytes, offset)
    block.starts.push(offset)
    block.ends.push(offset + line.length)
    if (line.truncated) block.truncated.push(start + i)
    offset += line.bytes.length
  })
  return block
}
