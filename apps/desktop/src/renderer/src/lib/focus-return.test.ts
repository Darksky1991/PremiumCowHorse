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

  it('a view-held note made while no overlay is open is ignored', () => {
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

  it('stacked overlays: closing both in turn finally requests the refocus of the view', () => {
    const focus = vi.fn()
    const Base = class {}
    vi.stubGlobal('HTMLElement', Base)
    const inPicker = Object.assign(new Base(), { isConnected: true, focus })
    const doc = { hasFocus: () => true, activeElement: null as unknown, body: {} }
    vi.stubGlobal('document', doc)
    // 选择器打开（最初焦点在网页视图，主进程交回应用界面）
    const picker = beginFocusReturn()
    noteViewHeldFocus()
    // 命令面板叠在选择器上：此时焦点在选择器内的元素
    doc.activeElement = inPicker
    const palette = beginFocusReturn()
    palette.restore()
    expect(focus).toHaveBeenCalledTimes(1) // 第二层还回选择器内的元素
    expect(consumeViewRefocus()).toBe(false) // 视图还不能拿回焦点
    picker.restore()
    expect(consumeViewRefocus()).toBe(true) // 最后一层关闭才登记还给视图
  })

  it('discard pops a layer without refocusing or requesting anything', () => {
    stubDocument(null)
    const layer = beginFocusReturn()
    noteViewHeldFocus()
    layer.discard()
    expect(consumeViewRefocus()).toBe(false)
    // 栈已空：之后的 note 不属于任何一层
    noteViewHeldFocus()
    beginFocusReturn().restore()
    expect(consumeViewRefocus()).toBe(false)
  })
})
