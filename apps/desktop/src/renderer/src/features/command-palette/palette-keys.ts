import { isImeKey } from '@renderer/lib/key-context'

/**
 * 面板根元素的按键预检：输入法组字中（含组字结束的那一下 key=Process / keyCode=229）的按键属于输入法，
 * 返回 'block'，调用方对该事件 preventDefault，cmdk 因 defaultPrevented 不处理（Enter 不执行选中项，方向键不移动）。
 * cmdk 1.1.1 自身也跳过 isComposing / 229，这里作为显式的第二道防线并有测试覆盖
 */
export function paletteKeyGuard(e: {
  isComposing: boolean
  key: string
  keyCode: number
}): 'block' | 'pass' {
  return isImeKey(e) ? 'block' : 'pass'
}
