import { AppError } from '@pch/shared'

/** 错误 → 本地化文案（errors 命名空间；非 AppError 为 UNKNOWN） */
export function errorText(t: (key: string) => string, e: unknown): string {
  return t(`errors:${errorCode(e)}`)
}

export function errorCode(e: unknown): string {
  return e instanceof AppError ? e.code : 'UNKNOWN'
}
