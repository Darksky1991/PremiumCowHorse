// 按行解码 readLines 的结果（设计 3.4：解码一律用 TextDecoder，在渲染端进行）
import type { EncodingLabel, LineBlock } from './types'

export const DEFAULT_MAX_CHARS = 10_000

export interface DecodeOptions {
  /** 块第一行开头要跳过的字节数（块从文件开头开始时传 BOM 长度） */
  skipBytesAtStart?: number
  /** 每行最多保留的字符数（UTF-16 单元，不切断代理对）；默认 10000 */
  maxChars?: number
}

export interface DecodedBlock {
  lines: string[]
  /** 解码结果中出现 U+FFFD（非法字节；被截断的行末尾残缺的字符不算） */
  replaced: boolean
}

export function decodeBlock(
  block: LineBlock,
  label: EncodingLabel,
  opts: DecodeOptions = {}
): DecodedBlock {
  const maxChars = opts.maxChars ?? DEFAULT_MAX_CHARS
  // ignoreBOM: true —— BOM 由调用方用 skipBytesAtStart 跳过；行首的 U+FEFF 不被解码器悄悄去掉
  const decoder = new TextDecoder(label, { ignoreBOM: true })
  const truncated = new Set(block.truncated)
  let replaced = false
  const lines = block.starts.map((start, i) => {
    const end = block.ends[i] ?? start
    const from = i === 0 ? Math.min(start + (opts.skipBytesAtStart ?? 0), end) : start
    const bytes = block.bytes.subarray(from, end)
    let text: string
    if (truncated.has(block.start + i)) {
      // 截断处可能切断多字节字符：stream 模式把残缺的尾部留在解码器里，再丢弃（flush 的结果）
      text = decoder.decode(bytes, { stream: true })
      decoder.decode()
    } else {
      text = decoder.decode(bytes)
    }
    if (text.includes('�')) replaced = true
    return clip(text, maxChars)
  })
  return { lines, replaced }
}

/** 截到 maxChars 个 UTF-16 单元；最后一个是高位代理时一并去掉 */
function clip(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  const end =
    maxChars > 0 && isHighSurrogate(text.charCodeAt(maxChars - 1)) ? maxChars - 1 : maxChars
  return text.slice(0, end)
}

const isHighSurrogate = (code: number): boolean => code >= 0xd800 && code <= 0xdbff
