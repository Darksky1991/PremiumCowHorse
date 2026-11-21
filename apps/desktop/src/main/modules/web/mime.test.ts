import { describe, expect, it } from 'vitest'
import { mimeOf } from './mime'

describe('mimeOf', () => {
  it.each([
    ['index.html', 'text/html'],
    ['A.HTM', 'text/html'],
    ['a.css', 'text/css'],
    ['a.mjs', 'text/javascript'],
    ['a.svg', 'image/svg+xml'],
    ['a.woff2', 'font/woff2'],
    ['a.mp4', 'video/mp4'],
    ['a.pdf', 'application/pdf'],
    ['a.wasm', 'application/wasm'],
    ['dir.v2/a.json', 'application/json']
  ])('%s -> %s', (name, mime) => {
    expect(mimeOf(name)).toBe(mime)
  })

  it('falls back to octet-stream', () => {
    expect(mimeOf('a.unknownext')).toBe('application/octet-stream')
    expect(mimeOf('noext')).toBe('application/octet-stream')
    expect(mimeOf('.html')).toBe('text/html')
  })
})
