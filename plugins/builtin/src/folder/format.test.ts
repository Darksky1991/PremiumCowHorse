import { describe, expect, it } from 'vitest'
import { formatSize, formatTime } from './format'

describe('formatSize', () => {
  it('shows bytes below 1024 and binary units with at most one decimal above', () => {
    expect(formatSize(0, 'en')).toBe('0 bytes')
    expect(formatSize(1023, 'ja')).toBe('1,023 バイト')
    expect(formatSize(1536, 'en')).toBe('1.5 kB')
    expect(formatSize(5 * 1024 ** 2 + 1, 'en')).toBe('5 MB')
    expect(formatSize(3 * 1024 ** 3, 'ja')).toBe('3 GB')
  })
})

describe('formatTime', () => {
  it('formats the date and the time to the minute in the given language', () => {
    const ms = new Date(2026, 10, 19, 8, 5, 9).getTime()
    expect(formatTime(ms, 'ja')).toBe('2026/11/19 8:05')
    expect(formatTime(ms, 'en')).toMatch(/11\/19\/26.*8:05/)
  })
})
