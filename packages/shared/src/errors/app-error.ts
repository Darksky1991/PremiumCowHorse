/**
 * 错误码按领域前缀划分。渲染端用错误码查 i18n 文案（errors.<code>），
 * 主进程不拼接用户可见文案。
 */
export const ERROR_CODES = [
  'UNKNOWN',
  'IPC_FORBIDDEN',
  'IPC_BAD_INPUT',
  'IPC_UNKNOWN_CHANNEL',
  'SETTINGS_INVALID'
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
