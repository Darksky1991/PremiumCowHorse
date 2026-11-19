import { describe, expect, it } from 'vitest'
import { isEditableTarget, keyCommand, mouseCommand } from './commands'

type Key = Parameters<typeof keyCommand>[0]

const key = (
  k: string,
  mods: Partial<Record<'alt' | 'ctrl' | 'shift' | 'meta', boolean>> = {}
): Key => ({
  key: k,
  altKey: mods.alt ?? false,
  ctrlKey: mods.ctrl ?? false,
  shiftKey: mods.shift ?? false,
  metaKey: mods.meta ?? false
})

describe('address bar commands', () => {
  it('Alt+← / Alt+→ go back / forward, also while typing (as in browsers)', () => {
    expect(keyCommand(key('ArrowLeft', { alt: true }), false)).toBe('back')
    expect(keyCommand(key('ArrowRight', { alt: true }), false)).toBe('forward')
    expect(keyCommand(key('ArrowLeft', { alt: true }), true)).toBe('back')
  })

  it('other modifiers or plain arrows are not commands', () => {
    expect(keyCommand(key('ArrowLeft'), false)).toBeNull()
    expect(keyCommand(key('ArrowLeft', { alt: true, ctrl: true }), false)).toBeNull()
    expect(keyCommand(key('ArrowRight', { alt: true, shift: true }), false)).toBeNull()
    expect(keyCommand(key('ArrowUp', { alt: true }), false)).toBeNull()
  })

  it('F5 refreshes unless focus is in a text field; modified F5 is not a command', () => {
    expect(keyCommand(key('F5'), false)).toBe('refresh')
    expect(keyCommand(key('F5'), true)).toBeNull()
    expect(keyCommand(key('F5', { ctrl: true }), false)).toBeNull()
    expect(keyCommand(key('F5', { shift: true }), false)).toBeNull()
  })

  it('mouse side buttons: 3 = back, 4 = forward', () => {
    expect(mouseCommand(3)).toBe('back')
    expect(mouseCommand(4)).toBe('forward')
    expect(mouseCommand(0)).toBeNull()
    expect(mouseCommand(1)).toBeNull()
    expect(mouseCommand(2)).toBeNull()
  })

  it('text fields are inputs, textareas, selects and contenteditable elements', () => {
    expect(isEditableTarget({ tagName: 'INPUT', isContentEditable: false })).toBe(true)
    expect(isEditableTarget({ tagName: 'TEXTAREA', isContentEditable: false })).toBe(true)
    expect(isEditableTarget({ tagName: 'SELECT', isContentEditable: false })).toBe(true)
    expect(isEditableTarget({ tagName: 'DIV', isContentEditable: true })).toBe(true)
    expect(isEditableTarget({ tagName: 'DIV', isContentEditable: false })).toBe(false)
    expect(isEditableTarget({ tagName: 'BUTTON', isContentEditable: false })).toBe(false)
    expect(isEditableTarget(null)).toBe(false)
  })
})
