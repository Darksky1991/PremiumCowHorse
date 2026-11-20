/**
 * 错误码按领域前缀划分。渲染端用错误码查 i18n 文案（errors.<code>），
 * 主进程不拼接用户可见文案。
 */
export const ERROR_CODES = [
  'UNKNOWN',
  'IPC_FORBIDDEN',
  'IPC_BAD_INPUT',
  'IPC_UNKNOWN_CHANNEL',
  'SETTINGS_INVALID',
  'WORKSPACE_NOT_FOUND',
  'WORKSPACE_DEFAULT_PROTECTED',
  'WORKSPACE_NAME_REQUIRED',
  'ENTRY_NOT_FOUND',
  'ENTRY_INVALID_PARENT',
  'ENTRY_KIND_MISMATCH',
  /** 系统拖入的路径位于临时目录之下（压缩包内的文件等，Chromium 写出的临时副本） */
  'ENTRY_TEMPORARY_PATH',
  'FS_NOT_FOUND',
  'FS_PERMISSION_DENIED',
  'FS_NOT_A_DIRECTORY',
  'FS_INVALID_URI',
  'FS_UNSUPPORTED_SCHEME',
  'FS_CANCELLED',
  'FS_TIMEOUT',
  'FS_UNAVAILABLE',
  /** 扫描进程或其缓存库（index.db）不可用 */
  'INDEX_UNAVAILABLE',
  /** 文本文档不存在：已关闭、因每窗口上限被关闭，或其窗口已销毁 */
  'DOC_NOT_FOUND'
] as const

export type ErrorCode = (typeof ERROR_CODES)[number]

export interface AppErrorPayload {
  code: ErrorCode
  /** 仅用于日志与调试，不直接展示给用户 */
  detail?: string
}

export class AppError extends Error {
  readonly code: ErrorCode
  readonly detail?: string

  constructor(payload: AppErrorPayload) {
    super(payload.detail ? `${payload.code}: ${payload.detail}` : payload.code)
    this.name = 'AppError'
    this.code = payload.code
    this.detail = payload.detail
  }

  toPayload(): AppErrorPayload {
    return { code: this.code, detail: this.detail }
  }
}

export function toErrorPayload(e: unknown): AppErrorPayload {
  if (e instanceof AppError) return e.toPayload()
  return { code: 'UNKNOWN', detail: e instanceof Error ? e.message : String(e) }
}
