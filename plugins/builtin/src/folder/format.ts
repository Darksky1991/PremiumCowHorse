const UNITS = ['kilobyte', 'megabyte', 'gigabyte', 'terabyte'] as const

/**
 * 列表中的文件大小：不到 1024 字节时显示字节数，否则以 1024 进位的单位显示（最多 1 位小数）。
 * 按界面语言用 Intl.NumberFormat 的单位格式化（与 fallback 插件的大小一致）。
 */
export function formatSize(size: number, language: string): string {
  if (size < 1024) {
    return new Intl.NumberFormat(language, {
      style: 'unit',
      unit: 'byte',
      unitDisplay: 'long'
    }).format(size)
  }
  let value = size / 1024
  let unit = 0
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024
    unit++
  }
  return new Intl.NumberFormat(language, {
    style: 'unit',
    unit: UNITS[unit],
    maximumFractionDigits: 1
  }).format(value)
}

const timeFormats = new Map<string, Intl.DateTimeFormat>()

/** 列表中的修改时间：日期 + 时刻（到分），按界面语言 */
export function formatTime(ms: number, language: string): string {
  let format = timeFormats.get(language)
  if (!format) {
    format = new Intl.DateTimeFormat(language, { dateStyle: 'short', timeStyle: 'short' })
    timeFormats.set(language, format)
  }
  return format.format(ms)
}
