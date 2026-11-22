import { describe, expect, it, vi } from 'vitest'
import { AppError } from '@pch/shared'
import { logHandlerError } from './log-error'

describe('logHandlerError', () => {
  it('DESKTOP_SNAPSHOT_NOT_FOUND 记 warn（一行，含通道与 detail）', () => {
    const logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }
    logHandlerError(
      logger,
      'desktop.get',
      new AppError({ code: 'DESKTOP_SNAPSHOT_NOT_FOUND', detail: '2' })
    )
    expect(logger.warn).toHaveBeenCalledWith('[ipc] desktop.get DESKTOP_SNAPSHOT_NOT_FOUND: 2')
    expect(logger.error).not.toHaveBeenCalled()
  })

  it('其他错误码与非 AppError 记 error', () => {
    const logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }
    const appError = new AppError({ code: 'FS_NOT_FOUND', detail: 'x' })
    const plain = new Error('boom')
    logHandlerError(logger, 'vfs.stat', appError)
    logHandlerError(logger, 'desktop.restore', plain)
    expect(logger.error).toHaveBeenNthCalledWith(1, '[ipc] vfs.stat', appError)
    expect(logger.error).toHaveBeenNthCalledWith(2, '[ipc] desktop.restore', plain)
    expect(logger.warn).not.toHaveBeenCalled()
  })
})
