import { describe, expect, it } from 'vitest'
import { isExecutableExtension } from './executable'

describe('isExecutableExtension', () => {
  it.each([
    'setup.exe',
    'a.com',
    'run.bat',
    'run.cmd',
    'x.ps1',
    'x.vbs',
    'x.vbe',
    'x.js',
    'x.jse',
    'x.wsf',
    'x.wsh',
    'x.msi',
    'x.msc',
    'x.scr',
    'x.lnk',
    'x.reg',
    'x.hta',
    'x.cpl',
    'x.pif',
    'x.scf',
    'x.msp',
    'x.jar',
    'x.appref-ms'
  ])('%s is executable', (name) => {
    expect(isExecutableExtension(name)).toBe(true)
  })

  it('is case-insensitive', () => {
    expect(isExecutableExtension('RUN.BAT')).toBe(true)
    expect(isExecutableExtension('起動.Cmd')).toBe(true)
  })

  it('ignores trailing dots and spaces (Windows strips them when opening)', () => {
    expect(isExecutableExtension('run.bat.')).toBe(true)
    expect(isExecutableExtension('run.bat .. ')).toBe(true)
  })

  it('judges the file name before an NTFS alternate data stream', () => {
    expect(isExecutableExtension('run.bat::$DATA')).toBe(true)
    expect(isExecutableExtension('run.bat:stream')).toBe(true)
    expect(isExecutableExtension('memo.txt:x.exe')).toBe(false)
  })

  it.each(['memo.txt', 'README.md', 'bat', '.bat.txt', 'a.json', 'a.jsx', 'exe', 'a.batch'])(
    '%s is not executable',
    (name) => {
      expect(isExecutableExtension(name)).toBe(false)
    }
  )

  it('treats a dot file named like an extension as executable (no other extension)', () => {
    // 「.bat」这样的文件名在 Windows 上仍按 .bat 关联打开
    expect(isExecutableExtension('.bat')).toBe(true)
  })
})
