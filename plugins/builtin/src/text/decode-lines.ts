import type { DocEncoding, DocLineBlock } from '@pch/plugin-sdk'
import { decodeBlock } from '@pch/text-engine'
import type { CachedLine } from './block-cache'

/** 每行显示的字符上限：超过时截断（20MB 的单行也只渲染这么多） */
export const MAX_LINE_CHARS = 10_000

export interface DecodeLinesOptions {
  label: DocEncoding
  /** DocumentInfo.encoding.bomLength：只对从第 0 行开始的块跳过 */
  bomLength: number
  maxChars?: number
}

/**
 * readLines 的结果 → 缓存的行：按 label 解码（@pch/text-engine 的 decodeBlock），
 * 标记读取时被截断（64KB）或解码后超过 maxChars 的行，以及含 U+FFFD 的行
 */
export function decodeLines(block: DocLineBlock, opts: DecodeLinesOptions): CachedLine[] {
  const maxChars = opts.maxChars ?? MAX_LINE_CHARS
  // 多解一个字符：据此判断是否超过上限（decodeBlock 截断时不切断代理对）
  const { lines } = decodeBlock(block, opts.label, {
    skipBytesAtStart: block.start === 0 ? opts.bomLength : 0,
    maxChars: maxChars + 1
  })
  const truncated = new Set(block.truncated)
  return lines.map((text, i) => {
    const clipped = text.length > maxChars
    const shown = clipped ? clip(text, maxChars) : text
    return {
      text: shown,
      truncated: clipped || truncated.has(block.start + i),
      replaced: shown.includes('\uFFFD')
    }
  })
}

/** 截到 maxChars 个 UTF-16 单元；最后一个是高位代理时一并去掉 */
function clip(text: string, maxChars: number): string {
  const code = text.charCodeAt(maxChars - 1)
  return text.slice(0, code >= 0xd800 && code <= 0xdbff ? maxChars - 1 : maxChars)
}
