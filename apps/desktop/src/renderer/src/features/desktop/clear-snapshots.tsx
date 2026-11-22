import { useState, type JSX } from 'react'
import { CircleAlertIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { DesktopRestoreResult } from '@pch/shared'
import { Button } from '@pch/ui/components/button'
import {
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@pch/ui/components/dialog'
import { Spinner } from '@pch/ui/components/spinner'
import { clearDesktop, useDesktopSnapshots } from '@renderer/data/desktop'
import { notify } from '@renderer/stores/messages-store'
import { errorText } from './error-text'

/** 恢复结果中有连不上 / 启动失败的项目：提示保留快照以便再试 */
const hasRetryableFailures = (result: DesktopRestoreResult): boolean =>
  result.skipped.some((s) => s.reason === 'unreachable' || s.reason === 'failed')

/**
 * 恢复后的「删除快照吗？」确认（设计第 9 节修订：不默认删除）。放在 DialogContent 内使用：
 * 「保留」在前且为默认焦点，Esc / 点外部由外层 Dialog 当作保留；「删除」→ desktop.clear（删除全部快照，
 * 主进程随后重新记录当前桌面）。onDone(true) = 已删除
 */
export function ClearSnapshotsBody({
  result,
  onDone
}: {
  result: DesktopRestoreResult
  onDone: (cleared: boolean) => void
}): JSX.Element {
  const { t } = useTranslation()
  const count = useDesktopSnapshots().data?.length ?? 0
  const [busy, setBusy] = useState(false)

  const clear = async (): Promise<void> => {
    setBusy(true)
    try {
      await clearDesktop()
      onDone(true)
    } catch (e) {
      notify('error', errorText(t, e))
      setBusy(false)
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t('desktop:clearTitle')}</DialogTitle>
        <DialogDescription>{t('desktop:clearDescription', { count })}</DialogDescription>
      </DialogHeader>
      {hasRetryableFailures(result) ? (
        <p role="status" className="flex items-start gap-2 text-sm text-muted-foreground">
          <CircleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
          {t('desktop:clearFailedNote')}
        </p>
      ) : null}
      <DialogFooter>
        <Button variant="outline" autoFocus disabled={busy} onClick={() => onDone(false)}>
          {t('desktop:clearKeep')}
        </Button>
        <Button variant="destructive" disabled={busy} onClick={() => void clear()}>
          {busy ? <Spinner data-icon="inline-start" /> : null}
          {t('desktop:clearConfirm')}
        </Button>
      </DialogFooter>
    </>
  )
}
