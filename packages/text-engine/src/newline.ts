// 换行的识别：按编码决定识别单位，在字节中查找换行单元。line-index 与 line-reader 共用。
import type { EncodingLabel, NewlineUnit } from './types'

const LF = 0x0a
const CR = 0x0d

export const unitOf = (label: EncodingLabel): NewlineUnit =>
  label === 'utf-16le' ? 'utf16le' : label === 'utf-16be' ? 'utf16be' : 'byte'

/** 一个换行单元的字节数 */
export const unitSize = (unit: NewlineUnit): 1 | 2 => (unit === 'byte' ? 1 : 2)

/**
 * 在 bytes[from..] 中查找第一个换行单元，返回其起点下标；找不到为 -1。
 * UTF-16 时 aligned 为单元起点下标的奇偶（0 / 1）；单元须完整位于 bytes 内，
 * 跨出末尾的单元由调用方处理（见 isNewlinePair）。
 */
export function findNewline(
  bytes: Uint8Array,
  from: number,
  unit: NewlineUnit,
  aligned: 0 | 1 = 0
): number {
  if (unit === 'byte') return bytes.indexOf(LF, from)
  if (unit === 'utf16le') {
    // LE 的 U+000A 是 0A 00：0x0A 在单元起点
    for (let i = from; ;) {
      const p = bytes.indexOf(LF, i)
      if (p < 0) return -1
      if (p % 2 !== aligned) {
        i = p + 1
        continue
      }
      if (p + 1 >= bytes.length) return -1
      if (bytes[p + 1] === 0) return p
      i = p + 2
    }
  }
  // BE 的 U+000A 是 00 0A：0x0A 在单元的第二个字节
  for (let i = from + 1; ;) {
    const p = bytes.indexOf(LF, i)
    if (p < 0) return -1
    const start = p - 1
    if (start % 2 !== aligned) {
      i = p + 1
      continue
    }
    if (bytes[start] === 0) return start
    i = p + 2
  }
}

/** 两个字节（first 在前）组成的 UTF-16 单元是否为换行；用于跨块的单元 */
export function isNewlinePair(first: number, second: number, unit: NewlineUnit): boolean {
  if (unit === 'utf16le') return first === LF && second === 0
  if (unit === 'utf16be') return first === 0 && second === LF
  return false
}

/** bytes[at..] 处的单元是否为 \r */
export function isCarriageReturn(bytes: Uint8Array, at: number, unit: NewlineUnit): boolean {
  if (unit === 'byte') return bytes[at] === CR
  if (unit === 'utf16le') return bytes[at] === CR && bytes[at + 1] === 0
  return bytes[at] === 0 && bytes[at + 1] === CR
}
