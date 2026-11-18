import { describe, expect, it } from 'vitest'
import { fileUriToLocalPath } from './local-path'

describe('fileUriToLocalPath', () => {
  it('decodes a drive-letter file URI with non-ASCII characters', () => {
    expect(fileUriToLocalPath('file:///C:/%E6%A1%88%E4%BB%B6')).toBe('C:\\案件')
  })

  it('converts a host-bearing file URI to a UNC path', () => {
    expect(fileUriToLocalPath('file://server/share/x')).toBe('\\\\server\\share\\x')
  })

  it('rejects a non-file scheme with FS_UNSUPPORTED_SCHEME', () => {
    expect(() => fileUriToLocalPath('ftp://h/x')).toThrowError(
      expect.objectContaining({ code: 'FS_UNSUPPORTED_SCHEME' })
    )
  })

  it('rejects a non-URI string with FS_INVALID_URI', () => {
    expect(() => fileUriToLocalPath('nope')).toThrowError(
      expect.objectContaining({ code: 'FS_INVALID_URI' })
    )
  })
})
