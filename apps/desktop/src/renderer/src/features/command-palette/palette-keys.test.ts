import { describe, expect, it } from 'vitest'
import { paletteKeyGuard } from './palette-keys'

type Key = { isComposing: boolean; key: string; keyCode: number }
const key = (over: Partial<Key>): Key => ({
  isComposing: false,
  key: 'Enter',
  keyCode: 13,
  ...over
})

describe('paletteKeyGuard', () => {
  it('blocks Enter while composing', () => {
    expect(paletteKeyGuard(key({ isComposing: true }))).toBe('block')
  })
  it('blocks the keydown that ends a composition (Process / 229)', () => {
    expect(paletteKeyGuard(key({ key: 'Process', keyCode: 229 }))).toBe('block')
    expect(paletteKeyGuard(key({ keyCode: 229 }))).toBe('block')
  })
  it('passes ordinary keys', () => {
    expect(paletteKeyGuard(key({}))).toBe('pass')
    expect(paletteKeyGuard(key({ key: 'ArrowDown', keyCode: 40 }))).toBe('pass')
  })
})
