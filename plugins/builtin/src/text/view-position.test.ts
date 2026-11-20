import { describe, expect, it } from 'vitest'
import { afterReadAll, effectiveTop, move, setFollow, type Frame } from './view-position'

const log: Frame = { visible: 10, total: 100, logLike: true }
const text: Frame = { ...log, logLike: false }

describe('effectiveTop', () => {
  it('is the end while following, the clamped top otherwise', () => {
    expect(effectiveTop({ top: 3, follow: true }, log)).toBe(90)
    expect(effectiveTop({ top: 300, follow: false }, log)).toBe(90)
    expect(effectiveTop({ top: 3, follow: false }, log)).toBe(3)
  })

  it('follows a growing document (appended lines)', () => {
    const pos = { top: 90, follow: true }
    expect(effectiveTop(pos, { ...log, total: 103 })).toBe(93)
  })
})

describe('move', () => {
  it('scrolling up turns following off', () => {
    expect(move({ top: 0, follow: true }, log, { by: -1 })).toEqual({ top: 89, follow: false })
  })

  it('scrolling down keeps following, and reaching the end of a log turns it on', () => {
    expect(move({ top: 0, follow: true }, log, { by: 5 })).toEqual({ top: 90, follow: true })
    expect(move({ top: 85, follow: false }, log, { by: 10 })).toEqual({ top: 90, follow: true })
    expect(move({ top: 80, follow: false }, log, { by: 5 })).toEqual({ top: 85, follow: false })
  })

  it('reaching the end of a non-log does not turn following on', () => {
    expect(move({ top: 85, follow: false }, text, { by: 10 })).toEqual({ top: 90, follow: false })
    expect(move({ top: 0, follow: false }, text, 'end')).toEqual({ top: 90, follow: false })
  })

  it('start / end', () => {
    expect(move({ top: 50, follow: true }, log, 'start')).toEqual({ top: 0, follow: false })
    expect(move({ top: 50, follow: false }, log, 'end')).toEqual({ top: 90, follow: true })
  })

  it('jumping (scrollbar) above the end turns following off', () => {
    expect(move({ top: 0, follow: true }, log, { to: 40 })).toEqual({ top: 40, follow: false })
    expect(move({ top: 0, follow: false }, log, { to: 500 })).toEqual({ top: 90, follow: true })
  })

  it('does nothing for a zero move', () => {
    const pos = { top: 7, follow: false }
    expect(move(pos, log, { by: 0 })).toBe(pos)
  })
})

describe('setFollow', () => {
  it('on jumps to the end; off stays where the view is', () => {
    expect(setFollow({ top: 3, follow: false }, text, true)).toEqual({ top: 90, follow: true })
    expect(setFollow({ top: 3, follow: true }, text, false)).toEqual({ top: 90, follow: false })
  })
})

describe('afterReadAll (partial window → full index)', () => {
  it('a head window starts at line 0: the window line is already the absolute line', () => {
    const pos = { top: 1234, follow: false }
    expect(afterReadAll(pos, { start: 0 })).toBe(pos)
  })

  it('a tail window: the line of its start is unknown, so the view goes to the end (and follows)', () => {
    expect(afterReadAll({ top: 1234, follow: false }, { start: 5_000_000 })).toEqual({
      top: 1234,
      follow: true
    })
  })

  it('following stays following', () => {
    const pos = { top: 0, follow: true }
    expect(afterReadAll(pos, { start: 5_000_000 })).toBe(pos)
  })
})
