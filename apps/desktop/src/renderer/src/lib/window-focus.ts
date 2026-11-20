/** 窗口是否聚焦（document.hasFocus）；不在浏览器环境时为 false */
export function isWindowFocused(): boolean {
  return typeof document !== 'undefined' && document.hasFocus()
}

/** 窗口获得 / 失去焦点时回调；返回取消订阅函数 */
export function subscribeWindowFocus(listener: () => void): () => void {
  window.addEventListener('focus', listener)
  window.addEventListener('blur', listener)
  return () => {
    window.removeEventListener('focus', listener)
    window.removeEventListener('blur', listener)
  }
}
