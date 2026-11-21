import type { JSX } from 'react'
import { ExitDialog } from './exit-dialog'
import { RestoreDialog } from './restore-dialog'
import { useExitRequest, useRestorePrompt } from './use-desktop-dialogs'

/**
 * 主窗口的启动恢复对话框与退出保存对话框（挂载一次）。两者不同时显示：退出询问出现时恢复对话框收起
 * （视同「後で」，候选仍可在侧栏找到），取消退出后也不再弹回。
 * 只在主窗口挂载；将来有弹出窗口时按窗口角色区分
 */
export function DesktopPrompts(): JSX.Element {
  const restore = useRestorePrompt()
  const exit = useExitRequest(restore.dismiss)
  return (
    <>
      <RestoreDialog snapshot={restore.snapshot} onClose={restore.dismiss} />
      <ExitDialog open={exit.open} onClose={exit.close} />
    </>
  )
}
