/**
 * 工作区「最终使用」时间的显示（选择器的卡片 / 列表、菜单式的每一项）。
 * 相对时间按界面语言用 Intl.RelativeTimeFormat（numeric: 'auto'，1 天前 = 「昨日」）；
 * 不到 1 分钟（含时钟回拨）返回 null，由调用方显示「たった今」。
 */

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const MONTH = 30 * DAY

export function relativeTime(timestamp: number, now: number, language: string): string | null {
  const diff = now - timestamp
  if (diff < MINUTE) return null
  const rtf = new Intl.RelativeTimeFormat(language, { numeric: 'auto' })
  if (diff < HOUR) return rtf.format(-Math.floor(diff / MINUTE), 'minute')
  if (diff < DAY) return rtf.format(-Math.floor(diff / HOUR), 'hour')
  if (diff < MONTH) return rtf.format(-Math.floor(diff / DAY), 'day')
  return rtf.format(-Math.floor(diff / MONTH), 'month')
}

/** 详细卡片的绝对时间（「2026/11/23 7:41」，格式随语言） */
export function absoluteTime(timestamp: number, language: string): string {
  return new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'short' }).format(
    timestamp
  )
}

/** 最终使用时间的文字：未使用 / たった今 / 相对时间 */
export function lastUsedText(
  lastOpenedAt: number | null,
  now: number,
  language: string,
  t: (key: 'neverUsed' | 'justNow') => string
): string {
  if (lastOpenedAt === null) return t('neverUsed')
  return relativeTime(lastOpenedAt, now, language) ?? t('justNow')
}
