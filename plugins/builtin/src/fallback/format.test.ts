import { describe, expect, it } from 'vitest'
import { formatBytes, formatDateTime } from './format'

describe('formatBytes', () => {
  it('shows small sizes in bytes only', () => {
    expect(formatBytes(0, 'en')).toEqual({ short: '0 bytes', bytes: null })
    expect(formatBytes(1, 'en')).toEqual({ short: '1 byte', bytes: null })
    expect(formatBytes(1023, 'ja')).toEqual({ short: '1,023 バイト', bytes: null })
  })

  it('uses binary units with at most one decimal and keeps the exact byte count', () => {
    expect(formatBytes(1024, 'en')).toEqual({ short: '1 kB', bytes: '1,024 bytes' })
    expect(formatBytes(1536, 'en')).toEqual({ short: '1.5 kB', bytes: '1,536 bytes' })
    expect(formatBytes(5 * 1024 ** 2 + 1, 'en')).toEqual({
      short: '5 MB',
      bytes: '5,242,881 bytes'
    })
    expect(formatBytes(3 * 1024 ** 3, 'ja')).toEqual({
      short: '3 GB',
      bytes: '3,221,225,472 バイト'
    })
    expect(formatBytes(2 * 1024 ** 4, 'en').short).toBe('2 TB')
  })
})

describe('formatDateTime', () => {
  it('formats in the given language with seconds', () => {
    const ms = new Date(2026, 10, 19, 8, 5, 9).getTime()
    expect(formatDateTime(ms, 'en')).toMatch(/2026/)
    expect(formatDateTime(ms, 'en')).toMatch(/8:05:09/)
    expect(formatDateTime(ms, 'ja')).toMatch(/2026\/11\/19/)
  })
})
