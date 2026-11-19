import { SEARCH_TOTAL_CAP, type SearchHit } from '@pch/shared'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/**
 * 相对时间（「3 分钟前」），按界面语言用 Intl.RelativeTimeFormat 格式化。
 * 不到 1 分钟（含时钟回拨导致的未来时刻）返回 null，由调用方显示「刚刚」。
 */
export function relativeTime(timestamp: number, now: number, language: string): string | null {
  const diff = now - timestamp
  if (diff < MINUTE) return null
  const rtf = new Intl.RelativeTimeFormat(language, { numeric: 'always' })
  if (diff < HOUR) return rtf.format(-Math.floor(diff / MINUTE), 'minute')
  if (diff < DAY) return rtf.format(-Math.floor(diff / HOUR), 'hour')
  return rtf.format(-Math.floor(diff / DAY), 'day')
}

/** 匹配总数：千位分隔；主进程计数到上限为止，达到上限时显示「10,000+」 */
export function formatTotal(total: number, language: string): string {
  const text = new Intl.NumberFormat(language).format(total)
  return total >= SEARCH_TOTAL_CAP ? `${text}+` : text
}

/**
 * 结果第二行「条目标签 › 父目录…」。tail 为最后一段父目录（单独给出，行宽不够时省略的是中间部分），
 * 没有父目录（直接位于条目根下、固定的单个文件条目）时为 null。
 */
export function locationParts(
  hit: SearchHit,
  entryLabel: string
): { head: string; tail: string | null } {
  const dirs = hit.relativePath === '' ? [] : hit.relativePath.split('/').slice(0, -1)
  const tail = dirs.pop() ?? null
  return { head: [entryLabel, ...dirs].join(' › '), tail }
}
