import { describe, expect, it } from 'vitest'
import { decodeBootstrapArg, encodeBootstrapArg, type BootstrapData } from './bootstrap'

const data: BootstrapData = {
  windowId: 'w-1',
  platform: 'win32',
  language: 'ja',
  theme: 'dark',
  accent: 'blue',
  density: 'compact'
}

describe('bootstrap argument', () => {
  it('round-trips through argv, including non-ASCII content', () => {
    const arg = encodeBootstrapArg({ ...data, windowId: '案件A' })
    expect(decodeBootstrapArg(['electron', '--foo', arg])).toEqual({ ...data, windowId: '案件A' })
  })

  it('returns null when the argument is missing or corrupt', () => {
    expect(decodeBootstrapArg(['electron'])).toBeNull()
    expect(decodeBootstrapArg(['--pch-bootstrap=%%%not-base64'])).toBeNull()
  })
})
