import { describe, expect, it } from 'vitest'
import { normalizeRemotePath } from './remote-path'

describe('normalizeRemotePath', () => {
  it('绝对路径：去掉首尾空白、重复与结尾的 /（根保持 /）', () => {
    expect(normalizeRemotePath(' /home/pchuser/ ')).toBe('/home/pchuser')
    expect(normalizeRemotePath('/opt//data')).toBe('/opt/data')
    expect(normalizeRemotePath('/')).toBe('/')
    expect(normalizeRemotePath('///')).toBe('/')
    expect(normalizeRemotePath('/opt/a b')).toBe('/opt/a b')
  })

  it('相对路径、空、含 . / .. 段或 NUL 的路径无效', () => {
    for (const bad of ['', '   ', 'home/x', '~/x', '/opt/../etc', '/opt/./x', '/a\0b']) {
      expect(normalizeRemotePath(bad)).toBeNull()
    }
  })
})
