import { describe, expect, it, vi } from 'vitest'
import { createOverlayTracker, isOverlayPopup, type OverlayElement } from './overlay-tracker'

/**
 * 测试环境没有 DOM（vitest 的 node 环境，未引入 jsdom）：用最小的假 DOM——
 * candidates 返回 body 下带 data-open / data-ending-style 的节点（真实实现为 querySelectorAll），
 * mutate() 相当于 MutationObserver 的回调。真实 DOM 中 Base UI 弹出层的判定由 e2e（web.spec.ts）覆盖
 */
function fakeDom(): {
  env: Parameters<typeof createOverlayTracker>[0]
  mount: (attrs: Record<string, string>) => OverlayElement & { attrs: Record<string, string> }
  remove: (el: OverlayElement) => void
  mutate: () => void
  observing: () => boolean
} {
  const nodes: Array<OverlayElement & { attrs: Record<string, string> }> = []
  let callback: (() => void) | null = null
  return {
    env: {
      candidates: () =>
        nodes.filter((n) => 'data-open' in n.attrs || 'data-ending-style' in n.attrs),
      observe: (onMutation) => {
        callback = onMutation
        return () => {
          callback = null
        }
      }
    },
    mount: (attrs) => {
      const node = {
        attrs,
        getAttribute: (name: string) => node.attrs[name] ?? null,
        hasAttribute: (name: string) => name in node.attrs
      }
      nodes.push(node)
      return node
    },
    remove: (el) => {
      nodes.splice(nodes.indexOf(el as (typeof nodes)[number]), 1)
    },
    mutate: () => callback?.(),
    observing: () => callback !== null
  }
}

describe('isOverlayPopup', () => {
  const el = (attrs: Record<string, string>): OverlayElement => ({
    getAttribute: (name) => attrs[name] ?? null,
    hasAttribute: (name) => name in attrs
  })

  it('counts open menus, dialogs, alert dialogs and listboxes, including the closing animation', () => {
    for (const role of ['menu', 'dialog', 'alertdialog', 'listbox']) {
      expect(isOverlayPopup(el({ role, 'data-open': '' }))).toBe(true)
      expect(isOverlayPopup(el({ role, 'data-closed': '', 'data-ending-style': '' }))).toBe(true)
    }
  })

  it('ignores tooltips (no role), closed popups and hidden popups', () => {
    expect(isOverlayPopup(el({ 'data-open': '' }))).toBe(false)
    expect(isOverlayPopup(el({ role: 'menu', 'data-closed': '' }))).toBe(false)
    expect(isOverlayPopup(el({ role: 'dialog', 'data-open': '', hidden: '' }))).toBe(false)
  })
})

describe('createOverlayTracker', () => {
  it('switches when a popup with data-open is mounted and removed', () => {
    const dom = fakeDom()
    const tracker = createOverlayTracker(dom.env)
    const listener = vi.fn()
    const unsubscribe = tracker.subscribe(listener)
    expect(tracker.get()).toBe(false)

    const menu = dom.mount({ role: 'menu', 'data-open': '' })
    dom.mutate()
    expect(tracker.get()).toBe(true)
    expect(listener).toHaveBeenCalledTimes(1)

    dom.remove(menu)
    dom.mutate()
    expect(tracker.get()).toBe(false)
    expect(listener).toHaveBeenCalledTimes(2)
    unsubscribe()
  })

  it('stays open while one of several popups is open, and through the closing animation', () => {
    const dom = fakeDom()
    const tracker = createOverlayTracker(dom.env)
    const listener = vi.fn()
    tracker.subscribe(listener)
    const menu = dom.mount({ role: 'menu', 'data-open': '' })
    const dialog = dom.mount({ role: 'dialog', 'data-open': '' })
    dom.mutate()
    dom.remove(menu)
    dom.mutate()
    expect(tracker.get()).toBe(true)

    // 关闭动画中：data-open 换成 data-closed + data-ending-style，动画结束后卸载
    delete dialog.attrs['data-open']
    dialog.attrs['data-closed'] = ''
    dialog.attrs['data-ending-style'] = ''
    dom.mutate()
    expect(tracker.get()).toBe(true)
    dom.remove(dialog)
    dom.mutate()
    expect(tracker.get()).toBe(false)
    // 只在 true / false 切换时通知（打开一次、关闭一次）
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('does not count a tooltip', () => {
    const dom = fakeDom()
    const tracker = createOverlayTracker(dom.env)
    const listener = vi.fn()
    tracker.subscribe(listener)
    dom.mount({ 'data-open': '' })
    dom.mutate()
    expect(tracker.get()).toBe(false)
    expect(listener).not.toHaveBeenCalled()
  })

  it('observes only while subscribed; get() without subscribers reads the DOM directly', () => {
    const dom = fakeDom()
    const tracker = createOverlayTracker(dom.env)
    expect(dom.observing()).toBe(false)
    dom.mount({ role: 'alertdialog', 'data-open': '' })
    expect(tracker.get()).toBe(true)

    const a = tracker.subscribe(() => undefined)
    const b = tracker.subscribe(() => undefined)
    expect(dom.observing()).toBe(true)
    a()
    expect(dom.observing()).toBe(true)
    b()
    expect(dom.observing()).toBe(false)
  })
})
