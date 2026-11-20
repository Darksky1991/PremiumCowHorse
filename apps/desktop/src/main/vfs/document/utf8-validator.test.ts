import { describe, expect, it } from 'vitest'
import { Utf8Validator, type Utf8Violation } from './utf8-validator'

const enc = (text: string): Uint8Array => new TextEncoder().encode(text)
const cat = (...parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

/** 按 chunk 字节切开后依次喂入；返回第一个非法处 */
function validate(bytes: Uint8Array, chunk = bytes.length || 1, base = 0): Utf8Violation | null {
  const v = new Utf8Validator()
  for (let i = 0; i < bytes.length; i += chunk) {
    const bad = v.feed(bytes.subarray(i, i + chunk), base + i)
    if (bad) return bad
  }
  return null
}

describe('Utf8Validator', () => {
  it('accepts valid UTF-8 split at any byte', () => {
    const text = enc('ascii 日本語 ログ 😀 é\n次の行\n')
    for (const chunk of [1, 2, 3, 5, text.length]) expect(validate(text, chunk)).toBeNull()
  })

  it('reports the start of the first invalid sequence and the start of its line', () => {
    // 「日本」的 Shift_JIS：93 FA 96 7B
    const bytes = cat(enc('line1\nab'), Uint8Array.of(0x93, 0xfa, 0x96, 0x7b), enc('\n'))
    for (const chunk of [1, 3, bytes.length]) {
      expect(validate(bytes, chunk, 100)).toEqual({ offset: 108, lineStart: 106 })
    }
  })

  it('rejects what TextDecoder rejects: overlong forms, surrogates, > U+10FFFF, lone continuation', () => {
    const cases = [
      [0xc0, 0x80],
      [0xe0, 0x80, 0x80],
      [0xed, 0xa0, 0x80],
      [0xf4, 0x90, 0x80, 0x80],
      [0xf5, 0x80, 0x80, 0x80],
      [0x80],
      [0xe3, 0x81, 0x41]
    ]
    for (const c of cases) {
      const bytes = cat(enc('ok'), Uint8Array.from(c))
      expect(() => new TextDecoder('utf-8', { fatal: true }).decode(bytes)).toThrow()
      expect(validate(bytes, 1)).toEqual({ offset: 2, lineStart: 0 })
    }
  })

  it('does not report a sequence cut off at the end of the data (the rest may still be written)', () => {
    expect(validate(cat(enc('abc'), Uint8Array.of(0xe6, 0x97)))).toBeNull()
  })
})
