import { useMemo, useState, type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import type { DesktopRestoreResult, DesktopSnapshot } from '@pch/shared'
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
import { entryIdsOf, picksOf } from './checklist-model'
import { ClearSnapshotsBody } from './clear-snapshots'
import { errorText } from './error-text'
import { ItemChecklist } from './item-checklist'
import { restoreSummary } from './snapshot-label'

/**
 * 启动时的「恢复哪些」对话框（设计 5.7）：默认全选（Explorer 按标签）；「復元」恢复所选项目并把结果汇总为应用消息，
 * 然后在同一对话框中确认是否删除快照（默认保留）。「後で」、Esc、点外部 = 不恢复（记录仍在桌面记录中）
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
  const [selected, setSelected] = useState(() => new Set(entryIdsOf(items)))
  const [busy, setBusy] = useState(false)
  /** 恢复完成：进入「删除快照吗？」确认 */
  const [done, setDone] = useState<DesktopRestoreResult | null>(null)

  const restore = async (): Promise<void> => {
    setBusy(true)
    try {
      const picks = picksOf(items, selected).map((p) => ({ id: Number(p.id), tabs: p.tabs }))
      const result = await restoreDesktop(snapshot.id, picks)
      const { level, message } = restoreSummary(result, t, i18n.language)
      notify(level, message)
      setDone(result)
    } catch (e) {
      notify('error', errorText(t, e))
      setBusy(false)
    }
  }

  if (done !== null) return <ClearSnapshotsBody result={done} onDone={onClose} />

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
