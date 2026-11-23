import { describe, expect, it } from 'vitest'
import { duration, ease, reducedMotionMode, spring } from './motion'

describe('motion tokens', () => {
  it('maps the reduce-motion setting to MotionConfig values', () => {
    expect(reducedMotionMode('system')).toBe('user')
    expect(reducedMotionMode('on')).toBe('always')
    expect(reducedMotionMode('off')).toBe('never')
  })

  it('keeps every duration within 0.3s', () => {
    expect(Object.values(duration).every((d) => d <= 0.3)).toBe(true)
  })

  it('keeps spring visual durations within 0.3s and exposes three eases', () => {
    for (const s of Object.values(spring)) expect(s.visualDuration).toBeLessThanOrEqual(0.3)
    expect(Object.keys(ease).sort()).toEqual(['enter', 'exit', 'standard'])
  })
})
