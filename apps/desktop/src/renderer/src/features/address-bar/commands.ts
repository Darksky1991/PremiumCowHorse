/** 地址栏的导航命令（快捷键与鼠标侧键共用） */
export type NavCommand = 'back' | 'forward' | 'refresh'

type KeyLike = Pick<KeyboardEvent, 'key' | 'altKey' | 'ctrlKey' | 'shiftKey' | 'metaKey'>

/**
 * 全局快捷键 → 命令：`Alt+←` / `Alt+→` 后退 / 前进（与浏览器相同，焦点在输入框时也有效）；
 * `F5` 刷新激活标签，焦点在输入框（editable）时除外。其他组合不是命令
 */
export function keyCommand(e: KeyLike, editable: boolean): NavCommand | null {
  if (e.ctrlKey || e.metaKey || e.shiftKey) return null
  if (e.altKey) {
    if (e.key === 'ArrowLeft') return 'back'
    if (e.key === 'ArrowRight') return 'forward'
    return null
  }
  return e.key === 'F5' && !editable ? 'refresh' : null
}

/** 鼠标侧键（MouseEvent.button）：3 = 后退、4 = 前进 */
export function mouseCommand(button: number): NavCommand | null {
  if (button === 3) return 'back'
  return button === 4 ? 'forward' : null
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
