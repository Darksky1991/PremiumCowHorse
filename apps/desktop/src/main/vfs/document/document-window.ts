// 文档的字节窗口（设计 3.1 节）：全量 = 整个文件；部分 = 开头或末尾约 4MB，边缘对齐到行边界。
import type { NewlineUnit, ReadAt } from '@pch/text-engine'

/** 部分模式的窗口大小 */
export const PARTIAL_WINDOW_BYTES = 4 * 1024 * 1024
/** 对齐窗口边缘时最多查看的字节数：其中没有换行（超长行）时保留原边缘 */
export const ALIGN_SCAN_BYTES = 64 * 1024

export interface WindowPlan {
  mode: 'full' | 'partial'
  start: number
  end: number
}

/**
 * 按大小决定模式与窗口。文件不超过 fullLimit（preview.maxTextSizeMB）或不超过部分窗口时全量；
 * 否则取开头或末尾 PARTIAL_WINDOW_BYTES。末尾窗口的起点取偶数：UTF-16 的单元相对文件开头对齐
 */
export function planWindow(size: number, fullLimit: number, at: 'start' | 'end'): WindowPlan {
  if (size <= fullLimit || size <= PARTIAL_WINDOW_BYTES)
    return { mode: 'full', start: 0, end: size }
  if (at === 'start') return { mode: 'partial', start: 0, end: PARTIAL_WINDOW_BYTES }
  const start = size - PARTIAL_WINDOW_BYTES
  return { mode: 'partial', start: start - (start % 2), end: size }
}

/**
 * 部分窗口的边缘对齐到行边界：起点（> 0 时）移到其后第一个换行之后，终点（< size 时）移到其前
 * 最后一个换行之后。ALIGN_SCAN_BYTES 内没有换行，或移动后窗口为空时保留原边缘。
 * UTF-16 时 plan 的边缘须为偶数，换行按单元查找，对齐后仍为偶数
 */
export async function alignWindow(
  plan: WindowPlan,
  size: number,
  unit: NewlineUnit,
  readAt: ReadAt
): Promise<WindowPlan> {
  if (plan.mode === 'full') return plan
  let { start, end } = plan
  if (start > 0) {
    const head = await readAt(start, Math.min(ALIGN_SCAN_BYTES, end - start))
    const p = afterFirstNewline(head, unit)
    if (p >= 0 && start + p < end) start += p
  }
  if (end < size) {
    const from = Math.max(start, end - ALIGN_SCAN_BYTES)
    const tail = await readAt(from, end - from)
    // 读到的比计划少（文件在 stat 之后变短）：不移动，交给之后的刷新处理
    const p = tail.length === end - from ? afterLastNewline(tail, unit) : -1
    if (p > 0) end = from + p
  }
  return { mode: plan.mode, start, end }
}

/** bytes 中第一个换行之后的下标；没有为 -1。bytes[0] 须为单元起点 */
export function afterFirstNewline(bytes: Uint8Array, unit: NewlineUnit): number {
  if (unit === 'byte') {
    const p = bytes.indexOf(0x0a)
    return p < 0 ? -1 : p + 1
  }
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    if (isNewlineUnit(bytes, i, unit)) return i + 2
  }
  return -1
}

/** bytes 中最后一个换行之后的下标；没有为 -1。bytes[0] 须为单元起点 */
export function afterLastNewline(bytes: Uint8Array, unit: NewlineUnit): number {
  if (unit === 'byte') {
    const p = bytes.lastIndexOf(0x0a)
    return p < 0 ? -1 : p + 1
  }
  for (let i = bytes.length - (bytes.length % 2) - 2; i >= 0; i -= 2) {
    if (isNewlineUnit(bytes, i, unit)) return i + 2
  }
  return -1
}

const isNewlineUnit = (bytes: Uint8Array, i: number, unit: 'utf16le' | 'utf16be'): boolean =>
  unit === 'utf16le'
    ? bytes[i] === 0x0a && bytes[i + 1] === 0
    : bytes[i] === 0 && bytes[i + 1] === 0x0a
