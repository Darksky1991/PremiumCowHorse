import { useMemo, useState, type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import type { DesktopSnapshot } from '@pch/shared'
import { Button } from '@pch/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@pch/ui/components/dialog'
import { Spinner } from '@pch/ui/components/spinner'
import { restoreDesktop } from '@renderer/data/desktop'
import { notify } from '@renderer/stores/messages-store'
import { errorText } from './error-text'
import { ItemChecklist } from './item-checklist'
import { restoreSummary } from './snapshot-label'

/**
 * 启动时的「恢复哪些」对话框（设计 5.7）：默认全选；「復元」恢复所选项目并把结果汇总为应用消息，
 * 「後で」、Esc、点外部 = 不恢复（记录仍在桌面记录中）
 */
export function RestoreDialog({
  snapshot,
  onClose
}: {
  snapshot: DesktopSnapshot | null
  onClose: () => void
}): JSX.Element {
  return (
    <Dialog open={snapshot !== null} onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent showCloseButton={false} className="sm:max-w-xl">
        {/* 内容在关闭后卸载，每次打开都重新初始化选择 */}
        {snapshot === null ? null : <RestoreBody snapshot={snapshot} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  )
}

function RestoreBody({
  snapshot,
  onClose
}: {
  snapshot: DesktopSnapshot
  onClose: () => void
}): JSX.Element {
  const { t, i18n } = useTranslation()
  const items = useMemo(
    () => snapshot.items.map((i) => ({ id: String(i.id), item: i.item })),
    [snapshot]
  )
  const [selected, setSelected] = useState(() => new Set(items.map((i) => i.id)))
  const [busy, setBusy] = useState(false)

  const restore = async (): Promise<void> => {
    setBusy(true)
    try {
      const ids = items.map((i) => i.id).filter((id) => selected.has(id))
      const result = await restoreDesktop(snapshot.id, ids.map(Number))
      const { level, message } = restoreSummary(result, t, i18n.language)
      notify(level, message)
      onClose()
    } catch (e) {
      notify('error', errorText(t, e))
      setBusy(false)
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t('desktop:restoreTitle')}</DialogTitle>
        <DialogDescription>{t('desktop:restoreDescription')}</DialogDescription>
      </DialogHeader>
      <div className="max-h-[50vh] overflow-y-auto">
        <ItemChecklist items={items} selected={selected} onChange={setSelected} />
      </div>
      <DialogFooter>
        <Button variant="outline" disabled={busy} onClick={onClose}>
          {t('desktop:restoreLater')}
        </Button>
        <Button disabled={busy || selected.size === 0} onClick={() => void restore()}>
          {busy ? <Spinner data-icon="inline-start" /> : null}
          {t('desktop:restoreSubmit')}
        </Button>
      </DialogFooter>
    </>
  )
}
