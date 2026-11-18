import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { toFileUri } from './input-path'

describe('toFileUri', () => {
  it('strips a surrounding pair of double quotes and round-trips non-ASCII paths', () => {
    expect(fileURLToPath(toFileUri('"C:\\案件 A"'))).toBe('C:\\案件 A')
  })

  it('does not leave a trailing slash, except on a drive root', () => {
    expect(toFileUri('C:\\foo\\')).toBe('file:///C:/foo')
    expect(toFileUri('C:\\')).toBe('file:///C:/')
    expect(toFileUri('\\\\srv\\share\\')).toBe('file://srv/share')
  })

  it('trims surrounding whitespace', () => {
    expect(fileURLToPath(toFileUri('  C:\\x  '))).toBe('C:\\x')
  })

  it.each(['locales', 'C:foo', '\\\\server', ''])('rejects %j with FS_INVALID_URI', (input) => {
    expect(() => toFileUri(input)).toThrowError(expect.objectContaining({ code: 'FS_INVALID_URI' }))
  })
})
