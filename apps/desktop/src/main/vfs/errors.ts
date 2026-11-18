import { AppError, type ErrorCode } from '@pch/shared'

const NODE_CODES: Record<string, ErrorCode> = {
  ENOENT: 'FS_NOT_FOUND',
  EACCES: 'FS_PERMISSION_DENIED',
  EPERM: 'FS_PERMISSION_DENIED',
  ENOTDIR: 'FS_NOT_A_DIRECTORY'
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
