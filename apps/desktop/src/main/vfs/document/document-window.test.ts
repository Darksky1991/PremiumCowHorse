import { describe, expect, it } from 'vitest'
import {
  afterFirstNewline,
  afterLastNewline,
  alignWindow,
  PARTIAL_WINDOW_BYTES,
  planWindow
} from './document-window'

const MB = 1024 * 1024
const ascii = (text: string): Uint8Array => new TextEncoder().encode(text)
const utf16le = (text: string): Uint8Array =>
  Uint8Array.from(text.split('').flatMap((c) => [c.charCodeAt(0) & 0xff, c.charCodeAt(0) >> 8]))
const utf16be = (text: string): Uint8Array =>
  Uint8Array.from(text.split('').flatMap((c) => [c.charCodeAt(0) >> 8, c.charCodeAt(0) & 0xff]))

describe('planWindow', () => {
  it('indexes the whole file when it is within the limit', () => {
    expect(planWindow(10 * MB, 50 * MB, 'end')).toEqual({ mode: 'full', start: 0, end: 10 * MB })
    expect(planWindow(0, 50 * MB, 'start')).toEqual({ mode: 'full', start: 0, end: 0 })
  })

  it('indexes the whole file when it is not larger than the partial window', () => {
    expect(planWindow(3 * MB, MB, 'end')).toEqual({ mode: 'full', start: 0, end: 3 * MB })
  })

  it('takes the first or last 4MB of a larger file', () => {
    expect(planWindow(100 * MB, 50 * MB, 'start')).toEqual({
      mode: 'partial',
      start: 0,
      end: PARTIAL_WINDOW_BYTES
    })
    expect(planWindow(100 * MB, 50 * MB, 'end')).toEqual({
      mode: 'partial',
      start: 100 * MB - PARTIAL_WINDOW_BYTES,
      end: 100 * MB
    })
  })

  it('starts a tail window at an even offset (UTF-16 units are aligned to the file start)', () => {
    const size = 100 * MB + 1
    const plan = planWindow(size, 50 * MB, 'end')
    expect(plan.start % 2).toBe(0)
    expect(plan.start).toBe(size - PARTIAL_WINDOW_BYTES - 1)
    expect(plan.end).toBe(size)
  })
})

describe('afterFirstNewline / afterLastNewline', () => {
  it('finds LF bytes for byte encodings', () => {
    expect(afterFirstNewline(ascii('ab\ncd\nef'), 'byte')).toBe(3)
    expect(afterLastNewline(ascii('ab\ncd\nef'), 'byte')).toBe(6)
    expect(afterFirstNewline(ascii('abc'), 'byte')).toBe(-1)
    expect(afterLastNewline(ascii('abc'), 'byte')).toBe(-1)
  })

  it('finds only aligned U+000A units for UTF-16', () => {
    // 「上」U+4E0A：LE 为 0A 4E，BE 为 4E 0A —— 都含 0x0A 但不是换行
    expect(afterFirstNewline(utf16le('上a\nb\nc'), 'utf16le')).toBe(6)
    expect(afterLastNewline(utf16le('上a\nb\nc'), 'utf16le')).toBe(10)
    expect(afterFirstNewline(utf16be('上a\nb\nc'), 'utf16be')).toBe(6)
    expect(afterLastNewline(utf16be('上a\nb\nc'), 'utf16be')).toBe(10)
    expect(afterFirstNewline(utf16le('上上'), 'utf16le')).toBe(-1)
    // 奇数位置上的 0A 00 不是换行单元
    expect(afterFirstNewline(Uint8Array.of(0x41, 0x0a, 0x00, 0x42), 'utf16le')).toBe(-1)
  })
})

describe('alignWindow', () => {
  const readFrom =
    (bytes: Uint8Array) =>
    async (offset: number, length: number): Promise<Uint8Array> =>
      bytes.slice(offset, offset + length)

  it('leaves a full window alone', async () => {
    const plan = { mode: 'full' as const, start: 0, end: 10 }
    expect(await alignWindow(plan, 10, 'byte', readFrom(ascii('0123456789')))).toEqual(plan)
  })

  it('moves a tail window start to the next line start', async () => {
    const file = ascii('aaaa\nbbbb\ncccc\n')
    const plan = { mode: 'partial' as const, start: 2, end: file.length }
    expect(await alignWindow(plan, file.length, 'byte', readFrom(file))).toMatchObject({ start: 5 })
  })

  it('moves a head window end back to the last line end', async () => {
    const file = ascii('aaaa\nbbbb\ncccc\n')
    const plan = { mode: 'partial' as const, start: 0, end: 12 }
    expect(await alignWindow(plan, file.length, 'byte', readFrom(file))).toMatchObject({
      start: 0,
      end: 10
    })
  })

  it('keeps the planned edge when no line boundary is found nearby', async () => {
    const file = ascii('x'.repeat(100))
    const tail = { mode: 'partial' as const, start: 10, end: 100 }
    expect(await alignWindow(tail, file.length, 'byte', readFrom(file))).toEqual(tail)
    const head = { mode: 'partial' as const, start: 0, end: 50 }
    expect(await alignWindow(head, file.length, 'byte', readFrom(file))).toEqual(head)
  })

  it('does not move a tail window start onto the file end', async () => {
    const file = ascii('xxxxxxxxx\n')
    const plan = { mode: 'partial' as const, start: 2, end: file.length }
    expect(await alignWindow(plan, file.length, 'byte', readFrom(file))).toEqual(plan)
  })

  it('keeps UTF-16 window edges on even offsets after the newline unit', async () => {
    const file = utf16le('上上\n上上\n上上\n')
    const plan = { mode: 'partial' as const, start: 2, end: 16 }
    const aligned = await alignWindow(plan, file.length, 'utf16le', readFrom(file))
    expect(aligned).toMatchObject({ start: 6, end: 12 })
  })
})
