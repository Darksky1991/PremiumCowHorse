import { afterEach, describe, expect, it, vi } from 'vitest'
import { beginFocusReturn, consumeViewRefocus, noteViewHeldFocus } from './focus-return'

afterEach(() => {
  vi.unstubAllGlobals()
  consumeViewRefocus()
})

function stubDocument(active: unknown): void {
  vi.stubGlobal('HTMLElement', class {})
  vi.stubGlobal('document', { hasFocus: () => true, activeElement: active, body: {} })
}

describe('focus return', () => {
  it('requests a refocus of the view only when the view held the focus and the overlay was dismissed', () => {
    stubDocument(null)
    const back = beginFocusReturn()
    noteViewHeldFocus()
    expect(consumeViewRefocus()).toBe(false)
    back.restore()
    expect(consumeViewRefocus()).toBe(true)
    expect(consumeViewRefocus()).toBe(false) // 取走即清除
  })

  it('does not request anything when the view did not hold the focus', () => {
    stubDocument(null)
    beginFocusReturn().restore()
    expect(consumeViewRefocus()).toBe(false)
  })

  it('a new overlay forgets the previous state', () => {
    stubDocument(null)
    noteViewHeldFocus()
    beginFocusReturn().restore()
    expect(consumeViewRefocus()).toBe(false)
  })

  it('an expired request is ignored', () => {
    stubDocument(null)
    const back = beginFocusReturn()
    noteViewHeldFocus()
    back.restore()
    expect(consumeViewRefocus(Date.now() + 10_000)).toBe(false)
  })

  it('refocuses the remembered app element when it is still attached', () => {
    const focus = vi.fn()
    const Base = class {}
    vi.stubGlobal('HTMLElement', Base)
    const el = Object.assign(new Base(), { isConnected: true, focus })
    vi.stubGlobal('document', { hasFocus: () => true, activeElement: el, body: {} })
    beginFocusReturn().restore()
    expect(focus).toHaveBeenCalledTimes(1)
  })
})
