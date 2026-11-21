import { describe, expect, it } from 'vitest'
import { isEditableTarget, isNavButton, keyCommand, mouseCommand } from './commands'

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
    expect(keyCommand(key('ArrowLeft', { alt: true }), { editable: false, modal: false })).toBe(
      'back'
    )
    expect(keyCommand(key('ArrowRight', { alt: true }), { editable: false, modal: false })).toBe(
      'forward'
    )
    expect(keyCommand(key('ArrowLeft', { alt: true }), { editable: true, modal: false })).toBe(
      'back'
    )
  })

  it('other modifiers or plain arrows are not commands', () => {
    expect(keyCommand(key('ArrowLeft'), { editable: false, modal: false })).toBeNull()
    expect(
      keyCommand(key('ArrowLeft', { alt: true, ctrl: true }), { editable: false, modal: false })
    ).toBeNull()
    expect(
      keyCommand(key('ArrowRight', { alt: true, shift: true }), { editable: false, modal: false })
    ).toBeNull()
    expect(
      keyCommand(key('ArrowDown', { alt: true }), { editable: false, modal: false })
    ).toBeNull()
  })

  it('Alt+↑ goes up one level, except while typing (Alt+↑ belongs to the text field / select there)', () => {
    expect(keyCommand(key('ArrowUp', { alt: true }), { editable: false, modal: false })).toBe('up')
    expect(keyCommand(key('ArrowUp', { alt: true }), { editable: true, modal: false })).toBeNull()
    expect(keyCommand(key('ArrowUp'), { editable: false, modal: false })).toBeNull()
    expect(
      keyCommand(key('ArrowUp', { alt: true, shift: true }), { editable: false, modal: false })
    ).toBeNull()
    expect(
      keyCommand(key('ArrowUp', { alt: true, ctrl: true }), { editable: false, modal: false })
    ).toBeNull()
  })

  it('F5 refreshes unless focus is in a text field; modified F5 is not a command', () => {
    expect(keyCommand(key('F5'), { editable: false, modal: false })).toBe('refresh')
    expect(keyCommand(key('F5'), { editable: true, modal: false })).toBeNull()
    expect(keyCommand(key('F5', { ctrl: true }), { editable: false, modal: false })).toBeNull()
    expect(keyCommand(key('F5', { shift: true }), { editable: false, modal: false })).toBeNull()
  })

  it('mouse side buttons: 3 = back, 4 = forward', () => {
    expect(mouseCommand(3, false)).toBe('back')
    expect(mouseCommand(4, false)).toBe('forward')
    expect(mouseCommand(0, false)).toBeNull()
    expect(mouseCommand(1, false)).toBeNull()
    expect(mouseCommand(2, false)).toBeNull()
  })

  it('a modal dialog is open: keys and side buttons do nothing (they would act on the tab behind it)', () => {
    const modal = { editable: false, modal: true }
    expect(keyCommand(key('ArrowLeft', { alt: true }), modal)).toBeNull()
    expect(keyCommand(key('ArrowRight', { alt: true }), modal)).toBeNull()
    expect(keyCommand(key('F5'), modal)).toBeNull()
    expect(keyCommand(key('ArrowUp', { alt: true }), modal)).toBeNull()
    expect(keyCommand(key('ArrowLeft', { alt: true }), { editable: true, modal: true })).toBeNull()
    expect(mouseCommand(3, true)).toBeNull()
    expect(mouseCommand(4, true)).toBeNull()
    // 侧键的默认动作（Chromium 的历史导航）仍要阻止：与是否有对话框无关
    expect(isNavButton(3)).toBe(true)
    expect(isNavButton(4)).toBe(true)
    expect(isNavButton(0)).toBe(false)
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
