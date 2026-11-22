import { describe, expect, it } from 'vitest'
import { AppError } from '@pch/shared'
import { toSftpAppError } from './sftp-errors'

describe('toSftpAppError', () => {
  it('maps SFTP status codes', () => {
    expect(toSftpAppError({ code: 2, message: 'No such file' }).code).toBe('FS_NOT_FOUND')
    expect(toSftpAppError({ code: 3, message: 'denied' }).code).toBe('FS_PERMISSION_DENIED')
    expect(toSftpAppError({ code: 6 }).code).toBe('FS_UNAVAILABLE')
    expect(toSftpAppError({ code: 7 }).code).toBe('FS_UNAVAILABLE')
    expect(toSftpAppError({ code: 4, message: 'Failure' }).code).toBe('UNKNOWN')
  })

  it('maps socket errors, abort and AppError', () => {
    expect(toSftpAppError(Object.assign(new Error('reset'), { code: 'ECONNRESET' })).code).toBe(
      'FS_UNAVAILABLE'
    )
    expect(toSftpAppError(new DOMException('Aborted', 'AbortError')).code).toBe('FS_CANCELLED')
    const a = new AppError({ code: 'CONN_AUTH_FAILED' })
    expect(toSftpAppError(a)).toBe(a)
  })

  it('detail has code and message only', () => {
    expect(toSftpAppError({ code: 2, message: 'No such file' }).detail).toBe('2: No such file')
  })
})
