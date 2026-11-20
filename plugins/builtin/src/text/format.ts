const UNITS = ['byte', 'kilobyte', 'megabyte', 'gigabyte', 'terabyte'] as const

/** 文件大小（1024 进位、最多 1 位小数），按界面语言用 Intl.NumberFormat 的单位格式化 */
export function formatSize(size: number, language: string): string {
  let value = size
  let unit = 0
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024
    unit++
  }
  return new Intl.NumberFormat(language, {
    style: 'unit',
    unit: UNITS[unit],
    unitDisplay: 'short',
    maximumFractionDigits: unit === 0 ? 0 : 1
  }).format(value)
}

/** 整数（千位分隔），按界面语言 */
export function formatCount(n: number, language: string): string {
  return new Intl.NumberFormat(language).format(n)
}
