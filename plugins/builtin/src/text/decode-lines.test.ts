import { describe, expect, it } from 'vitest'
import type { DocLineBlock } from '@pch/plugin-sdk'
import { decodeLines } from './decode-lines'

const enc = new TextEncoder()

/** 按行拼接（每行以 \n 结尾）构造 readLines 的结果 */
function block(start: number, texts: string[], truncated: number[] = []): DocLineBlock {
  const parts = texts.map((t) => enc.encode(`${t}\n`))
  const bytes = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  const starts: number[] = []
  const ends: number[] = []
  let at = 0
  for (const p of parts) {
    starts.push(at)
    ends.push(at + p.length - 1)
    bytes.set(p, at)
    at += p.length
  }
  return { start, bytes, starts, ends, truncated }
}

describe('decodeLines', () => {
  it('decodes each line and flags truncated lines by absolute line number', () => {
    const lines = decodeLines(block(10, ['a', 'bb', 'ccc'], [11]), {
      label: 'utf-8',
      bomLength: 0
    })
    expect(lines).toEqual([
      { text: 'a', truncated: false, replaced: false },
      { text: 'bb', truncated: true, replaced: false },
      { text: 'ccc', truncated: false, replaced: false }
    ])
  })

  it('skips the BOM only for the block starting at line 0', () => {
    const withBom = new Uint8Array([0xef, 0xbb, 0xbf, 0x61, 0x0a])
    const b: DocLineBlock = { start: 0, bytes: withBom, starts: [0], ends: [4], truncated: [] }
    expect(decodeLines(b, { label: 'utf-8', bomLength: 3 })[0]?.text).toBe('a')
    const later = { ...b, start: 5 }
    expect(decodeLines(later, { label: 'utf-8', bomLength: 3 })[0]?.text).toBe('\uFEFFa')
  })

  it('clips lines longer than maxChars and marks them truncated', () => {
    const [clipped, short] = decodeLines(block(0, ['x'.repeat(30), 'ok']), {
      label: 'utf-8',
      bomLength: 0,
      maxChars: 20
    })
    expect(clipped).toEqual({ text: 'x'.repeat(20), truncated: true, replaced: false })
    expect(short).toEqual({ text: 'ok', truncated: false, replaced: false })
  })

  it('does not split a surrogate pair when clipping', () => {
    const [clipped] = decodeLines(block(0, [`${'x'.repeat(19)}😀yz`]), {
      label: 'utf-8',
      bomLength: 0,
      maxChars: 20
    })
    expect(clipped?.text).toBe('x'.repeat(19))
    expect(clipped?.truncated).toBe(true)
  })

  it('flags lines containing replacement characters', () => {
    const bytes = new Uint8Array([0x61, 0xff, 0x0a, 0x62, 0x0a])
    const b: DocLineBlock = { start: 0, bytes, starts: [0, 3], ends: [2, 4], truncated: [] }
    expect(decodeLines(b, { label: 'utf-8', bomLength: 0 }).map((l) => l.replaced)).toEqual([
      true,
      false
    ])
  })

  it('decodes legacy encodings with the given label (Shift_JIS)', () => {
    // 「日本」= 93 FA 96 7B
    const bytes = new Uint8Array([0x93, 0xfa, 0x96, 0x7b, 0x0a])
    const b: DocLineBlock = { start: 0, bytes, starts: [0], ends: [4], truncated: [] }
    expect(decodeLines(b, { label: 'shift_jis', bomLength: 0 })[0]?.text).toBe('日本')
  })
})
