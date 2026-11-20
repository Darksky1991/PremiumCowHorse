// 测试用的辅助函数（只被 *.test.ts 引用，不从 index.ts 导出）
import { LineIndex, type LineIndexOptions } from './line-index'
import type { LineBlock, ReadAt } from './types'

const encoder = new TextEncoder()

export const utf8 = (text: string): Uint8Array => encoder.encode(text)

/** 把字符串编码为 UTF-16（不加 BOM） */
export function utf16(text: string, endian: 'le' | 'be'): Uint8Array {
  const bytes = new Uint8Array(text.length * 2)
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    const [hi, lo] = [code >> 8, code & 0xff]
    bytes[i * 2] = endian === 'le' ? lo : hi
    bytes[i * 2 + 1] = endian === 'le' ? hi : lo
  }
  return bytes
}

/** 以 chunkSize 字节为单位把 bytes 喂给新索引；finish 为 true 时结束索引 */
export function buildIndex(
  bytes: Uint8Array,
  options: LineIndexOptions = { unit: 'byte' },
  { chunkSize = 64 * 1024, windowStart = 0, finish = true } = {}
): LineIndex {
  const index = new LineIndex(windowStart, options)
  for (let i = 0; i < bytes.length; i += chunkSize) {
    index.feed(bytes.subarray(i, i + chunkSize), windowStart + i)
  }
  if (finish) index.finish(windowStart + bytes.length)
  return index
}

/** 内存中的 readAt；fileStart 为 bytes[0] 对应的文件偏移；stats 记录读取次数与字节数 */
export function memoryReadAt(
  bytes: Uint8Array,
  fileStart = 0
): { readAt: ReadAt; stats: { calls: number; bytes: number } } {
  const stats = { calls: 0, bytes: 0 }
  const readAt: ReadAt = async (offset, length) => {
    const from = Math.max(0, offset - fileStart)
    const out = bytes.slice(from, Math.min(bytes.length, from + length))
    stats.calls++
    stats.bytes += out.length
    return out
  }
  return { readAt, stats }
}

/** 把块中的各行按给定编码解码为字符串 */
export function blockLines(block: LineBlock, label = 'utf-8'): string[] {
  const decoder = new TextDecoder(label)
  return block.starts.map((s, i) => decoder.decode(block.bytes.subarray(s, block.ends[i])))
}
