import { describe, expect, it } from 'vitest'
import { displayName } from './path-name'

describe('displayName', () => {
  it.each([
    ['C:\\work\\設計書', '設計書'],
    ['C:\\work\\設計書\\', '設計書'],
    ['C:\\', 'C:'],
    ['Z:\\', 'Z:'],
    ['\\\\server\\share\\', '\\\\server\\share'],
    ['\\\\server\\share', '\\\\server\\share'],
    ['\\\\server\\share\\dir', 'dir']
  ])('%s → %s', (input, expected) => {
    expect(displayName(input)).toBe(expected)
  })
})
