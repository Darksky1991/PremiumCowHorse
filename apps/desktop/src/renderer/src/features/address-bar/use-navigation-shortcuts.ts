import { useEffect, useRef } from 'react'
import {
  isEditableTarget,
  isNavButton,
  keyCommand,
  mouseCommand,
  OPEN_MODAL_SELECTOR,
  type NavCommand
} from './commands'

/** 是否有模态对话框打开（此时快捷键与侧键不作用于背后的标签） */
const modalOpen = (): boolean => document.querySelector(OPEN_MODAL_SELECTOR) !== null

/**
 * 地址栏的全局快捷键（window 上监听）：`Alt+←` / `Alt+→`、F5（焦点在输入框时除外）、
 * 鼠标侧键（mouseup 的 button 3 / 4）。
 * - 视图内部已处理的按键（defaultPrevented，例如资源树内的 F5 刷新资源树）不再处理。
 * - 有模态对话框（Dialog / AlertDialog）打开时都不处理（否则作用于对话框背后的标签）。
 * - 侧键的 mousedown / mouseup / auxclick 都阻止默认动作，避免 Chromium 自己做历史导航。
 * run 取最新的（ref），监听只注册一次。
 */
export function useNavigationShortcuts(run: (command: NavCommand) => void): void {
  const runRef = useRef(run)
  useEffect(() => {
    runRef.current = run
  })

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.defaultPrevented) return
      const target = e.target instanceof HTMLElement ? e.target : null
      const command = keyCommand(e, { editable: isEditableTarget(target), modal: modalOpen() })
      if (command === null) return
      e.preventDefault()
      runRef.current(command)
    }
    const onMouseUp = (e: MouseEvent): void => {
      if (!isNavButton(e.button)) return
      e.preventDefault()
      const command = mouseCommand(e.button, modalOpen())
      if (command !== null) runRef.current(command)
    }
    const suppress = (e: MouseEvent): void => {
      if (isNavButton(e.button)) e.preventDefault()
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('mouseup', onMouseUp)
    window.addEventListener('mousedown', suppress)
    window.addEventListener('auxclick', suppress)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('mouseup', onMouseUp)
      window.removeEventListener('mousedown', suppress)
      window.removeEventListener('auxclick', suppress)
    }
  }, [])
}
