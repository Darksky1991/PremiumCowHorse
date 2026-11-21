import { useEffect, useMemo, useRef, useState, type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@pch/ui/components/button'
import { Checkbox } from '@pch/ui/components/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@pch/ui/components/dialog'
import { Spinner } from '@pch/ui/components/spinner'
import { useDesktopCurrent } from '@renderer/data/desktop'
import { call } from '@renderer/lib/ipc'
import { notify } from '@renderer/stores/messages-store'
import { errorText } from './error-text'
import { ItemChecklist } from './item-checklist'

/**
 * 退出时的「保存哪些」对话框（设计 5.7、第 8 节）：列出现场的项目（默认全选）。
 * 「保存して終了」「保存しないで終了」→ desktop.exit，主进程随后关闭窗口；
 * 「キャンセル」、Esc、点外部 → desktop.cancelExit。勾选「次回から確認しない」后两种退出都照传 dontAskAgain
 */
/** desktop.exit 返回后窗口仍未关闭的等待时间 */
const EXIT_IGNORED_MS = 2000

export function ExitDialog({
  open,
  onClose
}: {
  open: boolean
  onClose: () => void
}): JSX.Element | null {
  // 关闭后整体卸载：每次打开都重新取得现场并重置选择与忙碌状态
  return open ? <ExitSession onClose={onClose} /> : null
}

function ExitSession({ onClose }: { onClose: () => void }): JSX.Element {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])

  const cancel = async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    try {
      await call('desktop.cancelExit', undefined)
    } catch (e) {
      notify('error', errorText(t, e))
    }
    onClose()
  }

  const query = useDesktopCurrent()
  const { refetch } = query
  // 缓存可能是旧的：打开时重新取得（desktop.changed 也会使其失效）
  useEffect(() => {
    void refetch()
  }, [refetch])
  const items = useMemo(
    () => (query.data?.items ?? []).map((i) => ({ id: i.key, item: i.item })),
    [query.data]
  )
  // 记「不勾选」的项目：之后出现的新项目默认勾选
  const [deselected, setDeselected] = useState<Set<string>>(() => new Set())
  const [dontAskAgain, setDontAskAgain] = useState(false)
  const selected = useMemo(
    () => new Set(items.map((i) => i.id).filter((id) => !deselected.has(id))),
    [items, deselected]
  )

  const exit = async (save: boolean): Promise<void> => {
    setBusy(true)
    try {
      const keys = save ? items.map((i) => i.id).filter((id) => selected.has(id)) : []
      await call('desktop.exit', { save, keys, dontAskAgain })
      // 成功后主进程关闭窗口，对话框保持到那时；主进程忽略了回应（不在询问阶段）时窗口不会关闭，
      // 过一会儿仍在则复位并关闭对话框，不把用户困在里面
      timer.current = setTimeout(() => {
        setBusy(false)
        onClose()
      }, EXIT_IGNORED_MS)
    } catch (e) {
      notify('error', errorText(t, e))
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : void cancel())}>
      <DialogContent showCloseButton={false} className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t('desktop:exitTitle')}</DialogTitle>
          <DialogDescription>{t('desktop:exitDescription')}</DialogDescription>
        </DialogHeader>
        <div className="max-h-[50vh] overflow-y-auto">
          {items.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('desktop:exitNoItems')}</p>
          ) : (
            <ItemChecklist
              items={items}
              selected={selected}
              onChange={(next) =>
                setDeselected(new Set(items.map((i) => i.id).filter((id) => !next.has(id))))
              }
            />
          )}
        </div>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={dontAskAgain} onCheckedChange={setDontAskAgain} />
          {t('desktop:dontAskAgain')}
        </label>
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => void cancel()}>
            {t('desktop:cancel')}
          </Button>
          <Button variant="outline" disabled={busy} onClick={() => void exit(false)}>
            {t('desktop:exitNoSave')}
          </Button>
          <Button disabled={busy} onClick={() => void exit(true)}>
            {busy ? <Spinner data-icon="inline-start" /> : null}
            {t('desktop:exitSave')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
