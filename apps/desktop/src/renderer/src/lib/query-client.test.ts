import { describe, expect, it, vi } from 'vitest'
import { focusListenerSetup } from './query-client'

describe('focusListenerSetup', () => {
  it('window 的 focus 与 visibilitychange 都通知 TanStack Query 重新判断焦点', () => {
    const target = new EventTarget()
    const handleFocus = vi.fn()
    const cleanup = focusListenerSetup(target)(handleFocus)
    // Electron 中 Alt+Tab 切回窗口时页面一直可见，只有 focus，没有 visibilitychange
    target.dispatchEvent(new Event('focus'))
    expect(handleFocus).toHaveBeenCalledTimes(1)
    // 最小化后恢复等情况仍由 visibilitychange 覆盖
    target.dispatchEvent(new Event('visibilitychange'))
    expect(handleFocus).toHaveBeenCalledTimes(2)
    // 不带参数：由 focusManager 按 document.visibilityState 判断，而不是强制设为已聚焦
    expect(handleFocus).toHaveBeenLastCalledWith()

    cleanup?.()
    target.dispatchEvent(new Event('focus'))
    target.dispatchEvent(new Event('visibilitychange'))
    expect(handleFocus).toHaveBeenCalledTimes(2)
  })
})
