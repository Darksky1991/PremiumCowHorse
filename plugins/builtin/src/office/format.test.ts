import { describe, expect, it } from 'vitest'
import type { LaunchCapabilities } from '@pch/plugin-sdk'
import { capsForUri, officeIconFor } from './format'

describe('officeIconFor', () => {
  it.each([
    ['xlsx', 'excel'],
    ['xlsm', 'excel'],
    ['xls', 'excel'],
    ['xltx', 'excel'],
    ['xlsb', 'excel'],
    ['docx', 'word'],
    ['doc', 'word'],
    ['docm', 'word'],
    ['dotx', 'word'],
    ['pptx', 'powerpoint'],
    ['ppt', 'powerpoint'],
    ['pptm', 'powerpoint'],
    ['potx', 'powerpoint'],
    ['DOCX', 'word']
  ])('%s → %s', (ext, expected) => {
    expect(officeIconFor(ext)).toBe(expected)
  })
})

describe('capsForUri', () => {
  const caps: LaunchCapabilities = { ext: 'xlsx', appName: null, options: [] }

  it('returns the stored result only for the same uri', () => {
    expect(capsForUri({ uri: 'a', caps }, 'a')).toBe(caps)
    expect(capsForUri({ uri: 'a', caps: null }, 'a')).toBeNull()
  })

  it('returns undefined (detecting) for another uri or without a result', () => {
    expect(capsForUri({ uri: 'a', caps }, 'b')).toBeUndefined()
    expect(capsForUri(undefined, 'a')).toBeUndefined()
  })
})
