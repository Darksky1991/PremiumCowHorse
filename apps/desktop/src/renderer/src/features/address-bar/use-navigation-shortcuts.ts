import { useEffect, useRef } from 'react'
import { modalOpen } from '@renderer/lib/key-context'
import { useRegisterCommands } from '@renderer/stores/command-store'
import { isNavButton, mouseCommand, NAV_COMMANDS, type NavCommand } from './commands'

/**
 * 地址栏的导航命令：`Alt+←` / `Alt+→`、`Alt+↑` 与 F5 注册为命令（nav.back / nav.forward / nav.up / nav.refresh，
 * 由 features/shell 的统一分发器触发）；鼠标侧键（mouseup 的 button 3 / 4）仍在这里监听。
 * - 视图内部已处理的按键（defaultPrevented，例如资源树内的 F5 刷新资源树、目录视图自己处理的
 *   Alt+↑——它经 host.tabs.up 到达同一个上一级）不再处理（分发器的规则），不会执行两次。
 * - 有模态对话框（Dialog / AlertDialog）打开时都不处理（否则作用于对话框背后的标签）。
 * - 侧键的 mousedown / mouseup / auxclick 都阻止默认动作，避免 Chromium 自己做历史导航。
 * run 取最新的（ref），监听与命令只注册一次。
 */
export function useNavigationShortcuts(run: (command: NavCommand) => void): void {
  const runRef = useRef(run)
  useEffect(() => {
    runRef.current = run
  })

  useRegisterCommands(
    NAV_COMMANDS.map((c) => ({
      id: c.id,
      titleKey: c.titleKey,
      group: 'navigation' as const,
      shortcut: c.shortcut,
      allowInEditable: c.allowInEditable,
      run: () => runRef.current(c.command)
    })),
    []
  )

  useEffect(() => {
    const onMouseUp = (e: MouseEvent): void => {
      if (!isNavButton(e.button)) return
      e.preventDefault()
      const command = mouseCommand(e.button, modalOpen())
      if (command !== null) runRef.current(command)
    }
    const suppress = (e: MouseEvent): void => {
      if (isNavButton(e.button)) e.preventDefault()
    }
    window.addEventListener('mouseup', onMouseUp)
    window.addEventListener('mousedown', suppress)
    window.addEventListener('auxclick', suppress)
    return () => {
      window.removeEventListener('mouseup', onMouseUp)
      window.removeEventListener('mousedown', suppress)
      window.removeEventListener('auxclick', suppress)
    }
  }, [])
}
