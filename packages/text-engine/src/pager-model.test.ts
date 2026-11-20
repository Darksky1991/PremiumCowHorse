import { describe, expect, it } from 'vitest'
import { clampTop, maxTop, scrollLines, thumb, topFromThumb, type Pager } from './pager-model'

const pager = (top: number, visible = 10, total = 100): Pager => ({ top, visible, total })

describe('clampTop / maxTop', () => {
  it('keeps the last line at the bottom of the viewport', () => {
    expect(maxTop(pager(0))).toBe(90)
    expect(clampTop(pager(95))).toBe(90)
    expect(clampTop(pager(-3))).toBe(0)
    expect(clampTop(pager(42))).toBe(42)
  })

  it('pins to 0 when everything fits (total < visible, empty document)', () => {
    expect(maxTop(pager(0, 10, 4))).toBe(0)
    expect(clampTop(pager(7, 10, 4))).toBe(0)
    expect(clampTop(pager(3, 10, 0))).toBe(0)
    expect(clampTop(pager(5, 10, 10))).toBe(0)
  })

  it('treats a zero-height viewport as one visible line', () => {
    expect(maxTop(pager(0, 0, 5))).toBe(4)
  })

  it('rounds fractional tops', () => {
    expect(clampTop(pager(3.6))).toBe(4)
  })
})

describe('scrollLines', () => {
  it('moves by delta within bounds', () => {
    expect(scrollLines(pager(10), 5)).toEqual(pager(15))
    expect(scrollLines(pager(10), -50)).toEqual(pager(0))
    expect(scrollLines(pager(88), 5)).toEqual(pager(90))
  })

  it('does nothing when everything fits', () => {
    expect(scrollLines(pager(0, 10, 3), 5)).toEqual(pager(0, 10, 3))
  })
})

describe('thumb', () => {
  it('fills the track when everything fits', () => {
    expect(thumb(pager(0, 10, 4), 200)).toEqual({ offsetPx: 0, sizePx: 200 })
  })

  it('is proportional to visible / total and moves from 0 to the end of the track', () => {
    expect(thumb(pager(0), 200)).toEqual({ offsetPx: 0, sizePx: 20 })
    expect(thumb(pager(90), 200)).toEqual({ offsetPx: 180, sizePx: 20 })
    expect(thumb(pager(45), 200).offsetPx).toBeCloseTo(90)
  })

  it('never gets smaller than minThumbPx (scaled scrollbar for millions of lines)', () => {
    const big: Pager = { top: 0, visible: 40, total: 100_000_000 }
    expect(thumb(big, 300).sizePx).toBe(20)
    expect(thumb(big, 300, 32).sizePx).toBe(32)
    expect(thumb({ ...big, top: maxTop(big) }, 300).offsetPx).toBe(280)
  })

  it('does not exceed the track when the track is shorter than the minimum', () => {
    expect(thumb(pager(0), 10)).toEqual({ offsetPx: 0, sizePx: 10 })
    expect(thumb(pager(90), 10)).toEqual({ offsetPx: 0, sizePx: 10 })
  })
})

describe('topFromThumb', () => {
  it('maps thumb offsets back to tops (round trip for every top)', () => {
    for (const total of [11, 100, 1234, 100_000, 50_000_000]) {
      const p0: Pager = { top: 0, visible: 10, total }
      const last = maxTop(p0)
      const tops = total <= 2000 ? [...Array(last + 1).keys()] : [0, 1, 2, 777, last - 1, last]
      for (const top of tops) {
        const p = { ...p0, top }
        expect(topFromThumb(p, 300, thumb(p, 300).offsetPx)).toBe(top)
      }
    }
  })

  it('clamps offsets outside the track', () => {
    expect(topFromThumb(pager(0), 200, -50)).toBe(0)
    expect(topFromThumb(pager(0), 200, 999)).toBe(90)
    expect(topFromThumb(pager(0), 200, 90)).toBe(45)
  })

  it('returns 0 when there is nothing to scroll or no room for the thumb to move', () => {
    expect(topFromThumb(pager(0, 10, 4), 200, 100)).toBe(0)
    expect(topFromThumb(pager(0), 10, 5)).toBe(0)
  })
})
