import { describe, expect, it, vi } from 'vitest'
import { createLocator, driveTypeStatus, hostKey, location, shareKey } from './location'

const DRIVE_FIXED = 3
const DRIVE_REMOTE = 4

describe('createLocator', () => {
  it('treats sftp URIs as remote keyed by connection id', () => {
    const loc = createLocator(null)
    expect(loc.location('sftp://ID/x')).toBe('remote')
    expect(loc.shareKey('sftp://app1@ID/x')).toBe('sftp://ID')
    expect(loc.hostKey('sftp://app1@ID/x')).toBe('sftp://ID')
  })

  it('treats UNC paths as network and keys them by host and share (lower case)', () => {
    const driveType = vi.fn(() => DRIVE_FIXED)
    const loc = createLocator(driveType)
    expect(loc.location('file://FileSrv/Share$/案件/a')).toBe('network')
    expect(loc.shareKey('file://FileSrv/Share$/案件/a')).toBe('\\\\filesrv\\share$')
    expect(loc.hostKey('file://FileSrv/Share$/案件/a')).toBe('filesrv')
    expect(driveType).not.toHaveBeenCalled()
  })

  it('asks GetDriveTypeW once per drive letter', () => {
    const driveType = vi.fn((root: string) => (root === 'Z:\\' ? DRIVE_REMOTE : DRIVE_FIXED))
    const loc = createLocator(driveType)
    expect(loc.location('file:///C:/a')).toBe('local')
    expect(loc.location('file:///c:/b')).toBe('local')
    expect(loc.location('file:///Z:/share/x')).toBe('network')
    expect(driveType.mock.calls).toEqual([['C:\\'], ['Z:\\']])
  })

  it('keys drives by letter; a mapped network drive is its own host', () => {
    const loc = createLocator((root) => (root === 'Z:\\' ? DRIVE_REMOTE : DRIVE_FIXED))
    expect(loc.shareKey('file:///c:/a/b')).toBe('C:')
    expect(loc.hostKey('file:///c:/a/b')).toBe('local')
    expect(loc.shareKey('file:///z:/x')).toBe('Z:')
    expect(loc.hostKey('file:///z:/x')).toBe('Z:')
  })

  it('treats every drive as local when the drive type is unavailable', () => {
    const loc = createLocator(null)
    expect(loc.location('file:///Z:/x')).toBe('local')
    expect(loc.hostKey('file:///Z:/x')).toBe('local')
  })

  it('rejects URIs that are not file URIs', () => {
    expect(() => createLocator(null).location('ftp://host/x')).toThrow(
      expect.objectContaining({ code: 'FS_UNSUPPORTED_SCHEME' })
    )
  })
})

describe.runIf(process.platform === 'win32')('default locator', () => {
  it('reports the system drive as local', () => {
    const drive = (process.env.SystemDrive ?? 'C:').toUpperCase()
    expect(location(`file:///${drive}/`)).toBe('local')
    expect(shareKey(`file:///${drive}/Windows`)).toBe(drive)
    expect(hostKey(`file:///${drive}/Windows`)).toBe('local')
  })

  it('loads GetDriveTypeW through koffi', () => {
    expect(driveTypeStatus()).toEqual({ native: true })
  })
})
