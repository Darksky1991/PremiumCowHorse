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
