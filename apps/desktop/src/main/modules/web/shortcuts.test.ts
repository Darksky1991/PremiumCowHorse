import { describe, expect, it } from 'vitest'
import { APP_SHORTCUTS, matchShortcut, type KeyInput } from './shortcuts'

const key = (k: string, mods: Partial<KeyInput> = {}): KeyInput => ({
  type: 'keyDown',
  key: k,
  control: false,
  shift: false,
  alt: false,
  meta: false,
  isComposing: false,
  ...mods
})

describe('matchShortcut', () => {
  it('Ctrl+W 命中（大小写不敏感，返回表中的写法）', () => {
    expect(matchShortcut(key('w', { control: true }))).toEqual({
      key: 'w',
      ctrl: true,
      shift: false,
      alt: false
    })
    expect(matchShortcut(key('W', { control: true }))?.key).toBe('w')
  })

  it('F5、Alt+←/→/↑、Ctrl+Shift+F、Ctrl+B 命中', () => {
    expect(matchShortcut(key('F5'))?.key).toBe('F5')
    expect(matchShortcut(key('ArrowLeft', { alt: true }))?.key).toBe('ArrowLeft')
    expect(matchShortcut(key('ArrowRight', { alt: true }))?.key).toBe('ArrowRight')
    expect(matchShortcut(key('ArrowUp', { alt: true }))?.key).toBe('ArrowUp')
    expect(matchShortcut(key('F', { control: true, shift: true }))).toEqual({
      key: 'f',
      ctrl: true,
      shift: true,
      alt: false
    })
    expect(matchShortcut(key('b', { control: true }))?.key).toBe('b')
  })

  it('Ctrl+K、Ctrl+Shift+P、Ctrl+,、Alt+W 命中', () => {
    expect(matchShortcut(key('k', { control: true }))?.key).toBe('k')
    expect(matchShortcut(key('P', { control: true, shift: true }))?.key).toBe('p')
    expect(matchShortcut(key(',', { control: true }))?.key).toBe(',')
    expect(matchShortcut(key('w', { alt: true }))).toEqual({
      key: 'w',
      ctrl: false,
      shift: false,
      alt: true
    })
    expect(matchShortcut(key('p', { control: true }))).toBeNull()
  })

  it('Ctrl+S、修饰键不符（Ctrl+Shift+W、Shift+F5、无 Alt 的 ←）不命中', () => {
    expect(matchShortcut(key('s', { control: true }))).toBeNull()
    expect(matchShortcut(key('w', { control: true, shift: true }))).toBeNull()
    expect(matchShortcut(key('F5', { shift: true }))).toBeNull()
    expect(matchShortcut(key('ArrowLeft'))).toBeNull()
    expect(matchShortcut(key('ArrowUp'))).toBeNull()
    expect(matchShortcut(key('w', { control: true, meta: true }))).toBeNull()
  })

  it('keyUp 与输入法组字中不命中', () => {
    expect(matchShortcut(key('w', { control: true, type: 'keyUp' }))).toBeNull()
    expect(matchShortcut(key('F5', { isComposing: true }))).toBeNull()
  })

  it('表中只有渲染端 window 级 keydown 实际处理的组合', () => {
    expect(APP_SHORTCUTS.map((s) => s.key)).toEqual([
      'F5',
      'ArrowLeft',
      'ArrowRight',
      'ArrowUp',
      'w',
      'f',
      'b',
      'k',
      'p',
      ',',
      'w'
    ])
  })
})
