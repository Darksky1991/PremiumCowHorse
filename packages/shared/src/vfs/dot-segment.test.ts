import { describe, expect, it } from 'vitest'
import { hasDotSegment } from './dot-segment'

describe('hasDotSegment', () => {
  it.each([
    ['a/b/c.txt', false],
    ['', false],
    ['a/.hidden/b', false],
    ['a/b..c/d', false],
    ['a/.../b', false],
    ['.', true],
    ['..', true],
    ['a/./b', true],
    ['a/../b', true],
    ['a/b/..', true],
    ['../a', true],
    ['a/b\0c', true]
  ])('%j → %s', (rel, expected) => {
    expect(hasDotSegment(rel)).toBe(expected)
  })
})
