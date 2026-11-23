import { describe, expect, it } from 'vitest'
import { isEditableTarget, isImeKey } from './key-context'

describe('key context', () => {
  it('text inputs, textareas, selects and contenteditable are editable targets', () => {
    expect(isEditableTarget({ tagName: 'INPUT', isContentEditable: false })).toBe(true)
    expect(isEditableTarget({ tagName: 'TEXTAREA', isContentEditable: false })).toBe(true)
    expect(isEditableTarget({ tagName: 'SELECT', isContentEditable: false })).toBe(true)
    expect(isEditableTarget({ tagName: 'DIV', isContentEditable: true })).toBe(true)
    expect(isEditableTarget({ tagName: 'DIV', isContentEditable: false })).toBe(false)
    expect(isEditableTarget({ tagName: 'BUTTON', isContentEditable: false })).toBe(false)
    expect(isEditableTarget(null)).toBe(false)
  })

  it('isImeKey: composing, and the Process / 229 key at the end of composition', () => {
    expect(isImeKey({ isComposing: true, key: 'Enter', keyCode: 13 })).toBe(true)
    expect(isImeKey({ isComposing: false, key: 'Process', keyCode: 229 })).toBe(true)
    expect(isImeKey({ isComposing: false, key: 'Enter', keyCode: 13 })).toBe(false)
  })
})
