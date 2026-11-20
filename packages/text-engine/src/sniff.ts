// 文本 / 二进制判断（设计 3.8）：只看开头 8KB。
// BOM 或无 BOM 的 UTF-16 → 文本；否则出现 NUL（与 git 相同的判断）或控制字符过多 → 二进制。
import { detectBom } from './bom'
import type { EncodingLabel } from './types'
import { guessUtf16 } from './utf16-guess'

export const SNIFF_BYTES = 8192

/** 除 NUL 外的控制字符超过这个比例 → 二进制（文本中几乎不出现；随机字节中约 10%） */
const MAX_CONTROL_RATIO = 0.05

export interface SniffResult {
  kind: 'text' | 'binary' | 'empty'
  bom: EncodingLabel | null
}

export function sniff(head: Uint8Array): SniffResult {
  const bytes = head.subarray(0, SNIFF_BYTES)
  if (bytes.length === 0) return { kind: 'empty', bom: null }
  const bom = detectBom(bytes)
  if (bom) return { kind: 'text', bom: bom.label }
  if (guessUtf16(bytes)) return { kind: 'text', bom: null }
  let controls = 0
  for (const b of bytes) {
    if (b === 0) return { kind: 'binary', bom: null }
    if (isSuspiciousControl(b)) controls++
  }
  return { kind: controls / bytes.length > MAX_CONTROL_RATIO ? 'binary' : 'text', bom: null }
}

/** 文本中不该出现的控制字符：不含 TAB / LF / VT / FF / CR、ESC（ISO-2022-JP、ANSI 颜色）、Ctrl-Z（DOS 的文件结束标记） */
function isSuspiciousControl(b: number): boolean {
  return (b < 0x20 && !(b >= 0x09 && b <= 0x0d) && b !== 0x1b && b !== 0x1a) || b === 0x7f
}
