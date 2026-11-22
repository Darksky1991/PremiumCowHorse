import { AppError } from '@pch/shared'

/**
 * 错误 → 本地化文案（errors 命名空间）。AppError 实例（IPC 调用失败）与测试步骤中的错误载荷
 * （AppErrorPayload，含 code）都可以；其他为 UNKNOWN
 */
export function errorText(t: (key: string) => string, e: unknown): string {
  return t(`errors:${errorCode(e)}`)
}

export function errorCode(e: unknown): string {
  if (e instanceof AppError) return e.code
  const code = (e as { code?: unknown } | null)?.code
  return typeof code === 'string' ? code : 'UNKNOWN'
}
