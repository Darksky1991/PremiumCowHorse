/** 地址栏的导航命令（快捷键与鼠标侧键共用） */
export type NavCommand = 'back' | 'forward' | 'refresh'

type KeyLike = Pick<KeyboardEvent, 'key' | 'altKey' | 'ctrlKey' | 'shiftKey' | 'metaKey'>

/** 按键发生时的环境：焦点在文本输入处（editable）、有模态对话框打开（modal） */
export interface KeyContext {
  editable: boolean
  modal: boolean
}

/**
 * 全局快捷键 → 命令：`Alt+←` / `Alt+→` 后退 / 前进（与浏览器相同，焦点在输入框时也有效）；
 * `F5` 刷新激活标签，焦点在输入框（editable）时除外。有模态对话框打开时都不是命令
 * （否则会作用于对话框背后的标签）。其他组合不是命令
 */
export function keyCommand(e: KeyLike, { editable, modal }: KeyContext): NavCommand | null {
  if (modal || e.ctrlKey || e.metaKey || e.shiftKey) return null
  if (e.altKey) {
    if (e.key === 'ArrowLeft') return 'back'
    if (e.key === 'ArrowRight') return 'forward'
    return null
  }
  return e.key === 'F5' && !editable ? 'refresh' : null
}

/** 鼠标侧键（MouseEvent.button）：3 = 后退、4 = 前进；有模态对话框打开时不是命令 */
export function mouseCommand(button: number, modal: boolean): NavCommand | null {
  if (modal) return null
  if (button === 3) return 'back'
  return button === 4 ? 'forward' : null
}

/** 是否为侧键（其默认动作——Chromium 的历史导航——总要阻止，与是否有对话框无关） */
export function isNavButton(button: number): boolean {
  return button === 3 || button === 4
}

/**
 * 打开中的模态对话框（Base UI Dialog / AlertDialog 的弹出层：role 为 dialog / alertdialog，
 * 关闭时卸载或带 hidden）
 */
export const OPEN_MODAL_SELECTOR =
  '[role="dialog"]:not([hidden]), [role="alertdialog"]:not([hidden])'

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
