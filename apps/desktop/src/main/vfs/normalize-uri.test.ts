import { describe, expect, it } from 'vitest'
import { isUnderUri, normalizeRootUri } from './normalize-uri'

describe('normalizeRootUri', () => {
  it.each([
    ['file:///C:/a/', 'file:///C:/a'],
    ['file:///C:/a//', 'file:///C:/a'],
    ['file:///C:/a', 'file:///C:/a'],
    ['file://srv/share/', 'file://srv/share'],
    ['file:///C:/', 'file:///C:/'],
    ['file:///C:', 'file:///C:/']
  ])('%s → %s', (input, expected) => {
    expect(normalizeRootUri(input)).toBe(expected)
  })
})

describe('isUnderUri', () => {
  it.each([
    ['file:///C:/a', 'file:///C:/a', true],
    ['file:///C:/a/b', 'file:///C:/a', true],
    ['file:///C:/ab', 'file:///C:/a', false],
    ['file:///C:/a', 'file:///C:/a/b', false],
    ['file:///C:/a', 'file:///C:/', true],
    ['file:///D:/a', 'file:///C:/', false]
  ])('%s under %s = %s', (uri, root, expected) => {
    expect(isUnderUri(uri, root)).toBe(expected)
  })
})
