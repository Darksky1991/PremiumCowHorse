import { describe, expect, it } from 'vitest'
import {
  formatShortcut,
  matchesShortcut,
  parseShortcut,
  pickCommand,
  type DispatchKey
} from './shortcut'

const ev = (
  key: string,
  mods: Partial<Record<'ctrl' | 'shift' | 'alt' | 'meta', boolean>> = {},
  extra: { defaultPrevented?: boolean; isComposing?: boolean; repeat?: boolean } = {}
): DispatchKey => ({
  key,
  ctrlKey: mods.ctrl ?? false,
  shiftKey: mods.shift ?? false,
  altKey: mods.alt ?? false,
  metaKey: mods.meta ?? false,
  ...extra
})

describe('parseShortcut / formatShortcut', () => {
  it('parses modifiers and the key', () => {
    expect(parseShortcut('Ctrl+Shift+P')).toEqual({ key: 'p', ctrl: true, shift: true, alt: false })
    expect(parseShortcut('Alt+W')).toEqual({ key: 'w', ctrl: false, shift: false, alt: true })
    expect(parseShortcut('Ctrl+,').key).toBe(',')
    expect(parseShortcut('F5')).toEqual({ key: 'f5', ctrl: false, shift: false, alt: false })
    expect(() => parseShortcut('Super+K')).toThrow()
  })

  it('formats as Ctrl+Shift+P with arrows as symbols', () => {
    expect(formatShortcut('Ctrl+Shift+P')).toBe('Ctrl+Shift+P')
    expect(formatShortcut('shift+ctrl+p')).toBe('Ctrl+Shift+P')
    expect(formatShortcut('Alt+ArrowLeft')).toBe('Alt+←')
    expect(formatShortcut('F5')).toBe('F5')
    expect(formatShortcut('Ctrl+,')).toBe('Ctrl+,')
  })
})

describe('matchesShortcut', () => {
  it('matches the key case-insensitively with exactly the given modifiers', () => {
    expect(matchesShortcut(ev('P', { ctrl: true, shift: true }), 'Ctrl+Shift+P')).toBe(true)
    expect(matchesShortcut(ev('p', { ctrl: true }), 'Ctrl+Shift+P')).toBe(false)
    expect(matchesShortcut(ev(',', { ctrl: true }), 'Ctrl+,')).toBe(true)
    expect(matchesShortcut(ev('F5'), 'F5')).toBe(true)
    expect(matchesShortcut(ev('F5', { shift: true }), 'F5')).toBe(false)
    expect(matchesShortcut(ev('ArrowLeft', { alt: true }), 'Alt+ArrowLeft')).toBe(true)
    expect(matchesShortcut(ev('w', { ctrl: true, meta: true }), 'Ctrl+W')).toBe(false)
  })
})

describe('pickCommand', () => {
  const commands = [
    { id: 'tab.close', shortcut: 'Ctrl+W' },
    { id: 'palette.open', shortcut: 'Ctrl+K', allowInEditable: true },
    { id: 'nav.back', shortcut: 'Alt+ArrowLeft', allowInEditable: true },
    { id: 'hidden', shortcut: 'Ctrl+H', when: () => false },
    { id: 'modal.ok', shortcut: 'Ctrl+M', allowWithModal: true },
    { id: 'toggle', shortcut: 'Alt+W', allowInEditable: true, ignoreRepeat: true }
  ]
  const idle = { modal: false, editable: false }
  const modal = { modal: true, editable: false }
  const typing = { modal: false, editable: true }
  const id = (e: DispatchKey, ctx = idle): string | undefined => pickCommand(e, commands, ctx)?.id

  it('triggers by shortcut', () => {
    expect(id(ev('w', { ctrl: true }))).toBe('tab.close')
    expect(id(ev('x', { ctrl: true }))).toBeUndefined()
  })

  it('tab.close does not fire while a modal is open', () => {
    expect(id(ev('w', { ctrl: true }), modal)).toBeUndefined()
    expect(id(ev('m', { ctrl: true }), modal)).toBe('modal.ok')
    expect(id(ev('k', { ctrl: true }), modal)).toBeUndefined()
  })

  it('Ctrl+W does not fire in an input, Ctrl+K does', () => {
    expect(id(ev('w', { ctrl: true }), typing)).toBeUndefined()
    expect(id(ev('k', { ctrl: true }), typing)).toBe('palette.open')
  })

  it('skips composing / already handled events and commands whose when() is false', () => {
    expect(id(ev('w', { ctrl: true }, { isComposing: true }))).toBeUndefined()
    expect(id(ev('k', { ctrl: true }, { isComposing: true }), typing)).toBeUndefined()
    expect(id(ev('w', { ctrl: true }, { defaultPrevented: true }))).toBeUndefined()
    expect(id(ev('h', { ctrl: true }))).toBeUndefined()
  })

  it('ignores auto-repeat only for commands marked ignoreRepeat', () => {
    expect(id(ev('w', { alt: true }))).toBe('toggle')
    expect(id(ev('w', { alt: true }, { repeat: true }))).toBeUndefined()
    // 未标记的命令照常响应重复按键
    expect(id(ev('ArrowLeft', { alt: true }, { repeat: true }))).toBe('nav.back')
  })
})
