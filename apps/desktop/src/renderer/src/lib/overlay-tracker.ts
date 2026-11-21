import { useSyncExternalStore } from 'react'

/** 判定用到的元素接口（真实 DOM 的 Element；单元测试用假对象） */
export type OverlayElement = Pick<Element, 'getAttribute' | 'hasAttribute'>

/**
 * 弹出层的候选：Base UI（@base-ui/react 1.9）的 Popup 打开时带 `data-open`，关闭动画中为
 * `data-closed` + `data-ending-style`，动画结束后卸载（popupStateMapping / MenuPopupDataAttributes）。
 * 触发按钮带的是 `data-popup-open`，不在其列
 */
const CANDIDATE_SELECTOR = '[data-open], [data-ending-style]'

/**
 * 算作「应用的弹出层」的 role：菜单（DropdownMenu / ContextMenu 的 Menu.Popup）、对话框（Dialog / AlertDialog /
 * Popover 的 Popup）、下拉列表（Select 的 Popup）。Tooltip 的 Popup 没有 role，不计入（悬停提示频繁出现，
 * 每次都换截图会闪烁）
 */
const POPUP_ROLES: ReadonlySet<string> = new Set(['menu', 'dialog', 'alertdialog', 'listbox'])

/** 打开中（或正在关闭动画中）的应用弹出层；带 hidden 的不算 */
export function isOverlayPopup(el: OverlayElement): boolean {
  const role = el.getAttribute('role')
  if (role === null || !POPUP_ROLES.has(role) || el.hasAttribute('hidden')) return false
  return el.hasAttribute('data-open') || el.hasAttribute('data-ending-style')
}

export interface OverlayEnv {
  /** 当前带 data-open / data-ending-style 的元素（真实实现为 body.querySelectorAll） */
  candidates: () => Iterable<OverlayElement>
  /** DOM 变化时回调（真实实现为 body 上的 MutationObserver）；返回停止观察函数 */
  observe: (onMutation: () => void) => () => void
}

export interface OverlayTracker {
  get: () => boolean
  /** 打开 / 关闭切换时回调；返回取消订阅函数。有订阅者时才观察 DOM */
  subscribe: (listener: () => void) => () => void
}

/**
 * 「应用有打开中的弹出层」的追踪（设计 5.3.7）：浏览器视图是叠在窗口最上层的原生视图，
 * 弹出层打开期间宿主把视图换成截图。shadcn / Base UI 的弹出层都经 portal 渲染到 body 下，
 * 观察 body 子树中节点的增删与 data-open / data-ending-style / role / hidden 属性的变化，每次重新判定
 */
export function createOverlayTracker(env: OverlayEnv): OverlayTracker {
  const listeners = new Set<() => void>()
  let stop: (() => void) | null = null
  let open = false
  const scan = (): boolean => {
    for (const el of env.candidates()) if (isOverlayPopup(el)) return true
    return false
  }
  const update = (): void => {
    const next = scan()
    if (next === open) return
    open = next
    for (const l of [...listeners]) l()
  }
  return {
    get: () => (stop === null ? scan() : open),
    subscribe: (listener) => {
      listeners.add(listener)
      if (stop === null) {
        open = scan()
        stop = env.observe(update)
      }
      return () => {
        listeners.delete(listener)
        if (listeners.size === 0 && stop !== null) {
          stop()
          stop = null
        }
      }
    }
  }
}

const OBSERVED_ATTRIBUTES = ['data-open', 'data-ending-style', 'role', 'hidden']

let documentTracker: OverlayTracker | null = null

/** 当前页面 body 上的追踪器（首次使用时创建） */
function getDocumentTracker(): OverlayTracker {
  documentTracker ??= createOverlayTracker({
    candidates: () => document.body.querySelectorAll(CANDIDATE_SELECTOR),
    observe: (onMutation) => {
      const observer = new MutationObserver(onMutation)
      observer.observe(document.body, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: OBSERVED_ATTRIBUTES
      })
      return () => observer.disconnect()
    }
  })
  return documentTracker
}

const subscribeDocument = (listener: () => void): (() => void) =>
  getDocumentTracker().subscribe(listener)
const getDocumentSnapshot = (): boolean => getDocumentTracker().get()

/** 应用有打开中的弹出层（菜单 / 对话框 / 下拉 / 弹出框；含关闭动画期间） */
export function useOverlayOpen(): boolean {
  return useSyncExternalStore(subscribeDocument, getDocumentSnapshot)
}
