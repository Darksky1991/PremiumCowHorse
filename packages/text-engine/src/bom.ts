// BOM（字节顺序标记）识别：UTF-8 / UTF-16LE / UTF-16BE
import type { EncodingLabel } from './types'

export interface Bom {
  label: EncodingLabel
  /** BOM 的字节数（解码时跳过） */
  length: number
}

/** 文件开头的 BOM；没有时为 null */
export function detectBom(head: Uint8Array): Bom | null {
  const [a, b, c] = head
  if (a === 0xef && b === 0xbb && c === 0xbf) return { label: 'utf-8', length: 3 }
  if (a === 0xff && b === 0xfe) return { label: 'utf-16le', length: 2 }
  if (a === 0xfe && b === 0xff) return { label: 'utf-16be', length: 2 }
  return null
}
