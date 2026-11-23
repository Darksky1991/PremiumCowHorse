import { describe, expect, it } from 'vitest'
import { ringSlots, slotPose, trackCards, wrapOffset } from './ring-layout'

describe('ringSlots', () => {
  it('returns the front card and two on each side, wrapping around the ring', () => {
    expect(ringSlots(8, 0).map((s) => s.index)).toEqual([6, 7, 0, 1, 2])
    expect(ringSlots(8, 0).map((s) => s.offset)).toEqual([-2, -1, 0, 1, 2])
    expect(ringSlots(8, 7).map((s) => s.index)).toEqual([5, 6, 7, 0, 1])
  })

  it('never repeats a card when there are fewer than five', () => {
    const three = ringSlots(3, 1)
    expect(new Set(three.map((s) => s.index)).size).toBe(3)
    expect(three).toEqual([
      { index: 0, offset: -1 },
      { index: 1, offset: 0 },
      { index: 2, offset: 1 }
    ])
    const four = ringSlots(4, 0)
    expect(new Set(four.map((s) => s.index)).size).toBe(4)
    expect(four.map((s) => s.offset)).toEqual([-1, 0, 1, 2])
    expect(ringSlots(2, 1)).toEqual([
      { index: 1, offset: 0 },
      { index: 0, offset: 1 }
    ])
  })

  it('has only the front card for a single workspace and nothing for none', () => {
    expect(ringSlots(1, 0)).toEqual([{ index: 0, offset: 0 }])
    expect(ringSlots(0, 0)).toEqual([])
  })

  it('shows exactly five for five cards', () => {
    expect(ringSlots(5, 4).map((s) => s.index)).toEqual([2, 3, 4, 0, 1])
  })
})

describe('wrapOffset', () => {
  it('takes the shorter way round the ring', () => {
    expect(wrapOffset(7, 0, 8)).toBe(-1)
    expect(wrapOffset(1, 7, 8)).toBe(2)
    expect(wrapOffset(0, 0, 1)).toBe(0)
  })
})

describe('slotPose', () => {
  it('puts the front card flat at the origin and side cards further back, mirrored', () => {
    const front = slotPose(0, 204)
    expect(front).toMatchObject({ x: 0, z: 0, rotateY: 0, opacity: 1, dim: 0 })
    const left = slotPose(-1, 204)
    const right = slotPose(1, 204)
    expect(right.x).toBeGreaterThan(0)
    expect(right.z).toBeLessThan(0)
    expect(left.x).toBeCloseTo(-right.x)
    expect(left.z).toBeCloseTo(right.z)
    expect(left.rotateY).toBeCloseTo(-right.rotateY)
    expect(slotPose(2, 204).dim).toBeGreaterThan(right.dim)
  })

  it('hides the cards just outside the ring and compresses the reveal on open', () => {
    expect(slotPose(3, 204).opacity).toBe(0)
    const reveal = slotPose(1, 204, { reveal: true })
    expect(reveal.opacity).toBe(0)
    expect(reveal.x).toBeLessThan(slotPose(1, 204).x)
  })
})

describe('trackCards', () => {
  it('keeps the key while a card moves one step, and renews it when the card jumps across the ring', () => {
    // 3 张：0 在正面。向右转一格后 0 从正面移到左侧（相邻一步），2 从左侧跳到右侧（绕环）
    const first = trackCards(new Map(), [
      { id: 'c', offset: -1 },
      { id: 'a', offset: 0 },
      { id: 'b', offset: 1 }
    ])
    expect([...first.values()].map((c) => c.gen)).toEqual([0, 0, 0])
    const next = trackCards(first, [
      { id: 'a', offset: -1 },
      { id: 'b', offset: 0 },
      { id: 'c', offset: 1 }
    ])
    expect(next.get('a')).toEqual({ offset: -1, gen: 0 })
    expect(next.get('b')).toEqual({ offset: 0, gen: 0 })
    expect(next.get('c')).toEqual({ offset: 1, gen: 1 })
  })

  it('gives a card that left the ring a new key when it comes back (its old copy may still be exiting)', () => {
    const a = trackCards(new Map(), [{ id: 'x', offset: 2 }])
    const b = trackCards(a, [{ id: 'y', offset: 2 }])
    expect(b.get('x')).toEqual({ offset: null, gen: 0 })
    expect(trackCards(b, [{ id: 'x', offset: -2 }]).get('x')).toEqual({ offset: -2, gen: 1 })
  })
})
