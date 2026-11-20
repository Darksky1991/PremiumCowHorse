import { describe, expect, it } from 'vitest'
import { toAppError } from './errors'

describe('toAppError', () => {
  it.each(['ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'ENETUNREACH', 'EHOSTUNREACH', 'EIO'])(
    'maps %s to FS_UNAVAILABLE',
    (code) => {
      expect(toAppError({ code }).code).toBe('FS_UNAVAILABLE')
    }
  )

  it.each(['ERR_INVALID_FILE_URL_PATH', 'ERR_INVALID_FILE_URL_HOST', 'ERR_INVALID_URL'])(
    'maps %s to FS_INVALID_URI',
    (code) => {
      expect(toAppError({ code }).code).toBe('FS_INVALID_URI')
    }
  )

  it('keeps existing mappings', () => {
    expect(toAppError({ code: 'ENOENT' }).code).toBe('FS_NOT_FOUND')
  })
})
