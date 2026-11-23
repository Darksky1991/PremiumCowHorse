/**
 * 按键发生时的环境判断：模态对话框是否打开、焦点是否在文本输入处、是否为输入法按键。
 * 命令分发（features/shell）、导航侧键（features/address-bar）、命令面板 / 选择器共用。
 */

/**
 * 打开中的模态对话框（Base UI Dialog / AlertDialog 的弹出层：role 为 dialog / alertdialog，
 * 关闭时卸载或带 hidden）
 */
export const OPEN_MODAL_SELECTOR =
  '[role="dialog"]:not([hidden]), [role="alertdialog"]:not([hidden])'

/** 是否有模态对话框打开（此时快捷键与侧键不作用于背后的标签） */
export function modalOpen(): boolean {
  return document.querySelector(OPEN_MODAL_SELECTOR) !== null
}

/** 焦点所在的元素是否为文本输入处（input / textarea / select / contenteditable） */
export function isEditableTarget(
  target: Pick<HTMLElement, 'tagName' | 'isContentEditable'> | null
): boolean {
  if (target === null) return false
  return (
    target.isContentEditable ||
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT'
  )
}

/**
 * 是否为输入法（IME）的按键：组字中（isComposing），或 Chromium 在组字结束的那一下报告的
 * `key === 'Process'` / `keyCode === 229`。Enter 等按键在这些情况下属于输入法，不能当作提交 / 选择
 */
export function isImeKey(e: { isComposing: boolean; key: string; keyCode: number }): boolean {
  return e.isComposing || e.key === 'Process' || e.keyCode === 229
}
