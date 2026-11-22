import { AppError, type ErrorCode } from '@pch/shared'
import { toAppError } from './errors'

/** ssh2 SFTP 状态码：2 NO_SUCH_FILE、3 PERMISSION_DENIED、6 NO_CONNECTION、7 CONNECTION_LOST */
const STATUS_CODES: Record<number, ErrorCode> = {
  2: 'FS_NOT_FOUND',
  3: 'FS_PERMISSION_DENIED',
  6: 'FS_UNAVAILABLE',
  7: 'FS_UNAVAILABLE'
}

/**
 * 把 SFTP 状态码 / 套接字错误 / 中止错误转换为 AppError（detail 只含错误码与消息）。
 * code 为字符串的错误（Node 套接字错误码、AbortError）交给 toAppError 及其错误码表处理。
 */
export function toSftpAppError(e: unknown): AppError {
  if (e instanceof AppError) return e
  const err = e as { code?: unknown; name?: unknown; message?: unknown } | null
  // DOMException(AbortError) 也带数字 code（20），先判断中止
  if (err?.name === 'AbortError') return toAppError(e)
  if (typeof err?.code === 'number') {
    return new AppError({
      code: STATUS_CODES[err.code] ?? 'UNKNOWN',
      detail: [String(err.code), err.message].filter(Boolean).join(': ')
    })
  }
  return toAppError(e)
}
