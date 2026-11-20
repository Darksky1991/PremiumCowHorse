import { describe, expect, it } from 'vitest'
import { hasExtension, isLogLike } from './log-like'

describe('isLogLike', () => {
  it.each([
    'app.log',
    'APP.LOG',
    'catalina.out',
    'app.log.1',
    'app.log.12',
    'app.log.2026-11-20',
    'app.log.20261120',
    'access.log.2026_11_20',
    'app.log.1.gz.log'
  ])('%s is a log', (name) => {
    expect(isLogLike(name, false)).toBe(true)
  })

  it.each([
    'memo.txt',
    'catalog.json',
    'log',
    'app.logger',
    'blog.md',
    'app.log.bak',
    'app.out.txt',
    'readme'
  ])('%s is not a log', (name) => {
    expect(isLogLike(name, false)).toBe(false)
  })

  it('treats sniffed text without an extension as a log (messages, syslog)', () => {
    expect(isLogLike('messages', true)).toBe(true)
  })
})

describe('hasExtension', () => {
  it.each([
    ['messages', false],
    ['app.log', true],
    ['.gitignore', false],
    ['archive.', false],
    ['a.b.c', true]
  ])('%s → %s', (name, expected) => {
    expect(hasExtension(name)).toBe(expected)
  })
})
