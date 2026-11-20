// 文档的编码判断（设计 3.4 节）：BOM 看文件开头；其余在窗口的开头 / 中间 / 末尾各取 64KB 交给 detectEncoding。
// 全量模式建索引时发现非法 UTF-8 → 用含该处的样本重新判断（detectAround）。
import {
  detectEncoding,
  sampleRanges,
  SAMPLE_BYTES,
  type EncodingLabel,
  type ReadAt
} from '@pch/text-engine'
import type { Language } from '@pch/shared'
import type { Utf8Violation } from './utf8-validator'

export interface EncodingState {
  label: EncodingLabel
  confidence: 'certain' | 'likely' | 'guess'
  /** 文件开头的 BOM 字节数（与 label 一致的 BOM；没有为 0） */
  bomLength: number
  manual: boolean
}

export interface ByteWindow {
  start: number
  end: number
}

/** 打开时读取的文件开头：BOM、sniff（8KB）、身份（4KB）与窗口从文件开头开始时的第一个样本共用 */
export const FILE_HEAD_BYTES = SAMPLE_BYTES

/** 非法 UTF-8 所在行距行首超过这个字节数（超长行）时，样本改为从该处之前 SAMPLE_BYTES / 2 开始 */
const MAX_LINE_LOOKBACK = 3 * SAMPLE_BYTES

/** 文件开头的 BOM（certain）；没有为 null */
export function bomOf(fileHead: Uint8Array): EncodingState | null {
  const guess = detectEncoding([fileHead.subarray(0, 4)])
  return guess.confidence === 'certain' ? { ...guess, manual: false } : null
}

/** 手动指定的编码：文件开头有同一编码的 BOM 时保留其长度 */
export function manualEncoding(label: EncodingLabel, fileHead: Uint8Array): EncodingState {
  const bom = bomOf(fileHead)
  return {
    label,
    confidence: 'certain',
    bomLength: bom?.label === label ? bom.bomLength : 0,
    manual: true
  }
}

/**
 * 对齐窗口之前用来决定换行单元的编码：BOM 优先；否则只看 probe（从窗口计划起点读取的字节，起点为偶数）
 * 能否判为 UTF-16（其余编码的换行单元相同）
 */
export function probeEncoding(fileHead: Uint8Array, probe: Uint8Array): EncodingLabel {
  return (bomOf(fileHead) ?? detectEncoding([probe])).label
}

/** 自动判断：BOM → 否则窗口的开头 / 中间 / 末尾各 64KB（samples[0] 从窗口起点开始） */
export async function detectInWindow(
  window: ByteWindow,
  fileHead: Uint8Array,
  readAt: ReadAt,
  preferred: Language
): Promise<EncodingState> {
  const bom = bomOf(fileHead)
  if (bom) return bom
  const samples = await Promise.all(
    sampleRanges(window.end - window.start).map(({ offset, length }) =>
      readFrom(window.start + offset, length, fileHead, readAt)
    )
  )
  return { ...detectEncoding(samples, { preferred }), manual: false }
}

/**
 * 建索引时在 violation 处发现非法 UTF-8 后重新判断：样本 = 窗口开头 + 从该处所在行开始的一段
 * （detectEncoding 把第二个样本跳到其第一个 LF 之后，因此从行首前的 LF 开始取）
 */
export async function detectAround(
  window: ByteWindow,
  violation: Utf8Violation,
  fileHead: Uint8Array,
  readAt: ReadAt,
  preferred: Language
): Promise<EncodingState> {
  const { offset, lineStart } = violation
  const end = Math.min(window.end, offset + SAMPLE_BYTES / 2)
  if (lineStart <= window.start && offset - window.start <= MAX_LINE_LOOKBACK) {
    // 非法处在窗口的第一行：一个从窗口起点开始、包含该处的样本
    const head = await readFrom(window.start, end - window.start, fileHead, readAt)
    return { ...detectEncoding([head], { preferred }), manual: false }
  }
  const from = offset - lineStart <= MAX_LINE_LOOKBACK ? lineStart - 1 : offset - SAMPLE_BYTES / 2
  const [head, around] = await Promise.all([
    readFrom(window.start, Math.min(SAMPLE_BYTES, window.end - window.start), fileHead, readAt),
    readAt(from, end - from)
  ])
  return { ...detectEncoding([head, around], { preferred }), manual: false }
}

/** 从 offset 读 length 字节；已在文件开头的缓存中时不再读取 */
async function readFrom(
  offset: number,
  length: number,
  fileHead: Uint8Array,
  readAt: ReadAt
): Promise<Uint8Array> {
  if (offset + length <= fileHead.length) return fileHead.subarray(offset, offset + length)
  return readAt(offset, length)
}
