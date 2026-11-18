import { useState, type JSX, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { AppError } from '@pch/shared'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@pch/ui/components/alert-dialog'
import { Spinner } from '@pch/ui/components/spinner'
import { useEntryActions } from '@renderer/data/entries'

export interface RemoveTarget {
  entryId: string
  label: string
  /** 分组：其下的条目一并移除（主进程 entry.remove 会连同所有后代条目删除） */
  isGroup: boolean
}

export interface RemoveEntryDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  target: RemoveTarget
  finalFocus: RefObject<HTMLElement | null>
}

/** 移除条目的确认框：只移除工作区中的条目，绝不删除磁盘上的文件或文件夹 */
export function RemoveEntryDialog({
  open,
  onOpenChange,
  target,
  finalFocus
}: RemoveEntryDialogProps): JSX.Element {
  const { t } = useTranslation()
  const { remove } = useEntryActions()
  const [pending, setPending] = useState(false)

  const confirm = async (): Promise<void> => {
    setPending(true)
    try {
      await remove.mutateAsync(target.entryId)
      onOpenChange(false)
    } catch (e) {
      if (e instanceof AppError && e.code === 'ENTRY_NOT_FOUND') {
        // 条目已不存在：移除的目标已达成，静默关闭
        onOpenChange(false)
        return
      }
      toast.error(t(`errors:${e instanceof AppError ? e.code : 'UNKNOWN'}`))
    } finally {
      setPending(false)
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent finalFocus={finalFocus}>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('explorer:removeTitle', { name: target.label })}</AlertDialogTitle>
          <AlertDialogDescription>
            {t(target.isGroup ? 'explorer:removeGroupDescription' : 'explorer:removeDescription')}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('explorer:cancel')}</AlertDialogCancel>
          <AlertDialogAction disabled={pending} onClick={() => void confirm()}>
            {pending ? <Spinner data-icon="inline-start" /> : null}
            {t('explorer:remove')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
