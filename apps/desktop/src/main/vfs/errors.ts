import { AppError, type ErrorCode } from '@pch/shared'

const NODE_CODES: Record<string, ErrorCode> = {
  ENOENT: 'FS_NOT_FOUND',
  EACCES: 'FS_PERMISSION_DENIED',
  EPERM: 'FS_PERMISSION_DENIED',
  ENOTDIR: 'FS_NOT_A_DIRECTORY',
  // 网络位置不可达或中断
  ETIMEDOUT: 'FS_UNAVAILABLE',
  ECONNRESET: 'FS_UNAVAILABLE',
  ECONNREFUSED: 'FS_UNAVAILABLE',
  ENETUNREACH: 'FS_UNAVAILABLE',
  ENETDOWN: 'FS_UNAVAILABLE',
  EHOSTUNREACH: 'FS_UNAVAILABLE',
  EHOSTDOWN: 'FS_UNAVAILABLE',
  EIO: 'FS_UNAVAILABLE',
  // 非法的 file URL
  ERR_INVALID_FILE_URL_PATH: 'FS_INVALID_URI',
  ERR_INVALID_FILE_URL_HOST: 'FS_INVALID_URI',
  ERR_INVALID_URL: 'FS_INVALID_URI',
  ERR_INVALID_ARG_VALUE: 'FS_INVALID_URI'
}

/** 把 Node 的文件系统错误与中止错误转换为带错误码的 AppError（已是 AppError 则原样返回） */
export function toAppError(e: unknown): AppError {
  if (e instanceof AppError) return e
  const err = e as { code?: unknown; name?: unknown; message?: unknown }
  if (err?.name === 'AbortError') return new AppError({ code: 'FS_CANCELLED' })
  const nodeCode = typeof err?.code === 'string' ? err.code : undefined
  const code = (nodeCode && NODE_CODES[nodeCode]) || 'UNKNOWN'
  return new AppError({ code, detail: [nodeCode, err?.message].filter(Boolean).join(': ') })
}
