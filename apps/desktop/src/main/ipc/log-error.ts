import { AppError, type ErrorCode } from '@pch/shared'
import type { Logger } from '../infra/logger'

/**
 * 预期内的错误码：属于正常流程（例：快照页在快照被清空 / 删除后重新获取），按 warn 记录，
 * 不让 error 日志被正常操作淹没
 */
const EXPECTED_CODES: ReadonlySet<ErrorCode> = new Set<ErrorCode>(['DESKTOP_SNAPSHOT_NOT_FOUND'])

/** IPC handler 抛错时的日志：预期内的错误码记一行 warn，其余记 error（带错误对象） */
export function logHandlerError(logger: Logger, channel: string, e: unknown): void {
  if (e instanceof AppError && EXPECTED_CODES.has(e.code)) {
    logger.warn(`[ipc] ${channel} ${e.message}`)
    return
  }
  logger.error(`[ipc] ${channel}`, e)
}
