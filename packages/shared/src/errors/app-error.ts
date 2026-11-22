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
  'DOC_NOT_FOUND',
  /** 启动本机程序（Office 等）失败 */
  'LAUNCH_FAILED',
  /** 桌面记录的快照不存在（已删除，或属于别的机器） */
  'DESKTOP_SNAPSHOT_NOT_FOUND',
  /** 连接不存在（已删除） */
  'CONN_NOT_FOUND',
  /** 认证失败（密码 / 密钥错误）；失败后不再自动重试 */
  'CONN_AUTH_FAILED',
  /** 私钥无法解析：只支持 OpenSSH / PEM 与 PuTTY PPK v2（RSA / DSA），或口令错误 */
  'CONN_KEY_INVALID',
  /** 用户拒绝信任服务器的主机密钥 */
  'CONN_HOST_KEY_REJECTED',
  /** 主机密钥与已信任的不同，已拒绝连接 */
  'CONN_HOST_KEY_CHANGED',
  /** sudo 身份切换的密码错误；不再自动重试 */
  'CONN_SUDO_AUTH_FAILED',
  /** sudo 不允许当前用户切换到该身份 */
  'CONN_SUDO_DENIED',
  /** 身份切换失败（超时、通道提前关闭等） */
  'CONN_SUDO_FAILED',
  /** 服务器上找不到 sftp-server，无法以其他身份启动 */
  'CONN_SFTP_SERVER_NOT_FOUND',
  /** 服务器隐藏了其他用户的进程，无法安全地切换身份 */
  'CONN_PROCESS_LIST_HIDDEN',
  /** 保存的密码 / 口令无法解密（系统加密不可用或数据已损坏） */
  'CONN_SECRET_UNAVAILABLE'
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
