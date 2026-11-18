/** 断开后重试探测的退避（设计 4.7）：30 秒起每次翻倍，最长 5 分钟 */
export const BACKOFF_BASE_MS = 30_000
export const BACKOFF_MAX_MS = 300_000

/** 第 attempt 次（从 0 起）失败后到下一次探测的等待时长 */
export function backoffMs(attempt: number): number {
  return Math.min(BACKOFF_BASE_MS * 2 ** Math.max(0, attempt), BACKOFF_MAX_MS)
}
