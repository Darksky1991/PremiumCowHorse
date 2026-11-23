/**
 * 「关闭浮层后把焦点还回原处」的小工具（命令面板、工作区选择器共用）。
 *
 * 浮层打开前焦点可能在两处：应用内的元素，或网页视图（Markdown / HTML / PDF）。
 * - 应用内元素：打开时记住，关闭时 focus()（Base UI 通常已经还了，这里兜底）。
 * - 网页视图：视图持有焦点时主进程在截图替身（web.freeze）里把焦点交回应用界面（yielded），
 *   web-host 据此调用 noteViewHeldFocus()；浮层关闭时 restore() 登记「请求还给视图」，
 *   web-host 在随后的 web.unfreeze 中以 refocus 取走（consumeViewRefocus）。
 * 浮层因执行了会改变焦点的动作（打开标签、切换工作区…）而关闭时不要调用 restore()，改调 discard()。
 * 浮层可以叠放（命令面板叠在工作区选择器上）：各层的状态按栈保存，begin 压栈、restore / discard 弹出自己那一层，
 * 「视图原本持有焦点」记在打开时位于栈顶的那一层（最先打开的一层）。
 */

/** restore 登记的请求只在这段时间内有效（超过说明没有对应的 unfreeze，不能影响之后的截图） */
const REFOCUS_TTL_MS = 2000

interface Layer {
  /** 这一层打开时，焦点在网页视图（主进程已交回应用界面） */
  viewHeldFocus: boolean
}

/** 打开中的浮层（栈底 = 最先打开） */
const layers: Layer[] = []
let refocusRequestedAt: number | null = null

/** web-host：浮层造成的截图替身中，视图原本持有焦点（主进程已交回应用界面）。记在栈顶那一层；没有浮层时忽略 */
export function noteViewHeldFocus(): void {
  const top = layers[layers.length - 1]
  if (top !== undefined) top.viewHeldFocus = true
}

/** web-host：取走（并清除）「把焦点还给视图」的请求 */
export function consumeViewRefocus(now: number = Date.now()): boolean {
  const at = refocusRequestedAt
  refocusRequestedAt = null
  return at !== null && now - at <= REFOCUS_TTL_MS
}

export interface FocusReturn {
  /** 浮层不是因执行动作而关闭：把焦点还回打开前的位置 */
  restore: () => void
  /** 浮层因执行了动作而关闭：只弹出这一层，不还焦点 */
  discard: () => void
}

/** 浮层打开时调用：压入一层，记住应用内的焦点元素 */
export function beginFocusReturn(): FocusReturn {
  const layer: Layer = { viewHeldFocus: false }
  layers.push(layer)
  const active = document.hasFocus() ? document.activeElement : null
  const origin = active instanceof HTMLElement && active !== document.body ? active : null
  const pop = (): void => {
    const i = layers.indexOf(layer)
    if (i >= 0) layers.splice(i, 1)
  }
  return {
    restore: () => {
      pop()
      if (layer.viewHeldFocus) refocusRequestedAt = Date.now()
      else if (origin?.isConnected === true) origin.focus()
    },
    discard: pop
  }
}
