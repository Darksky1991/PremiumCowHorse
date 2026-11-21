import type { JSX } from 'react'
import { ExitDialog } from './exit-dialog'
import { RestoreDialog } from './restore-dialog'
import { useExitRequest, useRestorePrompt } from './use-desktop-dialogs'

/** 主窗口的启动恢复对话框与退出保存对话框（挂载一次） */
export function DesktopPrompts(): JSX.Element {
  const restore = useRestorePrompt()
  const exit = useExitRequest()
  return (
    <>
      <RestoreDialog snapshot={restore.snapshot} onClose={restore.dismiss} />
      <ExitDialog open={exit.open} onClose={exit.close} />
    </>
  )
}
