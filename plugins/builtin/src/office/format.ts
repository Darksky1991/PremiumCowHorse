import type { LaunchCapabilities } from '@pch/plugin-sdk'

const UNITS = ['kilobyte', 'megabyte', 'gigabyte', 'terabyte'] as const

/**
 * 文件大小：不到 1024 字节时只显示字节数（short），否则以 1024 进位的单位显示（最多 1 位小数），
 * 并给出精确的字节数（bytes）。按界面语言用 Intl.NumberFormat 的单位格式化。
 */
export function formatBytes(
  size: number,
  language: string
): { short: string; bytes: string | null } {
  const bytes = new Intl.NumberFormat(language, {
    style: 'unit',
    unit: 'byte',
    unitDisplay: 'long'
  }).format(size)
  if (size < 1024) return { short: bytes, bytes: null }
  let value = size / 1024
  let unit = 0
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024
    unit++
  }
  const short = new Intl.NumberFormat(language, {
    style: 'unit',
    unit: UNITS[unit],
    maximumFractionDigits: 1
  }).format(value)
  return { short, bytes }
}

/** 日期与时刻（含秒），按界面语言格式化 */
export function formatDateTime(ms: number, language: string): string {
  return new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'medium' }).format(ms)
}

/** 面板标题处的图标种类：按扩展名首字母（x* 表格 / d* 文档 / p* 演示文稿），其余按文档 */
export function officeIconFor(ext: string): 'word' | 'excel' | 'powerpoint' {
  const first = ext.toLowerCase().charAt(0)
  if (first === 'x') return 'excel'
  if (first === 'p') return 'powerpoint'
  return 'word'
}

/**
 * 检测结果只对检测时的 uri 有效：uri 变化后（同一面板实例换到另一个文件）返回 undefined（= 检测中），
 * 不显示上一个文件的结果。null 表示检测失败（宿主已提示）
 */
export function capsForUri(
  state: { uri: string; caps: LaunchCapabilities | null } | undefined,
  uri: string
): LaunchCapabilities | null | undefined {
  return state !== undefined && state.uri === uri ? state.caps : undefined
}
