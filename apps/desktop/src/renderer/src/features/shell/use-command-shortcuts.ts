import { useEffect } from 'react'
import { isEditableTarget, modalOpen } from '@renderer/lib/key-context'
import { pickCommand } from '@renderer/lib/shortcut'
import { useCommandStore } from '@renderer/stores/command-store'

/**
 * 唯一的 window keydown 快捷键分发：按命令注册表（stores/command-store）匹配，规则见 lib/shortcut 的 pickCommand
 * （已 defaultPrevented / 组字中、模态对话框、文本输入处、when）。命中则 preventDefault 并执行。
 * 网页视图中的按键由主进程转发（web.shortcut）并作为 window 上的 keydown 重新派发，也经过这里。
 */
export function useCommandShortcuts(): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      const target = e.target instanceof HTMLElement ? e.target : null
      const command = pickCommand(e, useCommandStore.getState().commands(), {
        modal: modalOpen(),
        editable: isEditableTarget(target)
      })
      if (command === null) return
      e.preventDefault()
      command.run()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}
