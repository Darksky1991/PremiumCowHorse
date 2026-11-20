import { describe, expect, it } from 'vitest'
import { HEAD_BYTES, judgeChange, type FileSnapshot } from './document-identity'

const bytes = (length: number, fill = 0x61): Uint8Array => new Uint8Array(length).fill(fill)
const snap = (size: number, head: Uint8Array, mtime = 1): FileSnapshot => ({ size, mtime, head })

describe('judgeChange', () => {
  const before = snap(10_000, bytes(HEAD_BYTES))

  it('reports a missing file', () => {
    expect(judgeChange(before, null)).toBe('missing')
  })

  it('treats a growing file with the same head as appended', () => {
    expect(judgeChange(before, snap(20_000, bytes(HEAD_BYTES), 2))).toBe('appended')
  })

  it('treats a smaller file as reset (truncated / rotated)', () => {
    expect(judgeChange(before, snap(9_999, bytes(HEAD_BYTES), 2))).toBe('reset')
  })

  it('treats a changed head as reset even when the file grew', () => {
    const head = bytes(HEAD_BYTES)
    head[HEAD_BYTES - 1] = 0x62
    expect(judgeChange(before, snap(20_000, head, 2))).toBe('reset')
  })

  it('compares only the bytes known before for a small file that grew', () => {
    const small = snap(3, bytes(3))
    const grown = new Uint8Array(HEAD_BYTES).fill(0x7a)
    grown.set(bytes(3))
    expect(judgeChange(small, snap(5000, grown, 2))).toBe('appended')
    grown[0] = 0x7a
    expect(judgeChange(small, snap(5000, grown, 2))).toBe('reset')
  })

  it('treats the same size with a new modification time as reset (rewritten in place)', () => {
    expect(judgeChange(before, snap(10_000, bytes(HEAD_BYTES), 2))).toBe('reset')
  })

  it('reports no change for the same size, head and modification time', () => {
    expect(judgeChange(before, snap(10_000, bytes(HEAD_BYTES)))).toBe('unchanged')
  })
})
