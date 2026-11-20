import type { JSX, RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import { notify } from '@renderer/stores/messages-store'
import { AppError } from '@pch/shared'
import { useEntryActions } from '@renderer/data/entries'
import { NameDialog } from './name-dialog'

export interface RenameTarget {
  entryId: string
  label: string
}

export interface RenameDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  target: RenameTarget
  finalFocus: RefObject<HTMLElement | null>
}

/** 重命名条目：只修改条目的标签（entry.update），磁盘上的名称不变 */
export function RenameDialog({
  open,
  onOpenChange,
  target,
  finalFocus
}: RenameDialogProps): JSX.Element {
  const { t } = useTranslation()
  const { update } = useEntryActions()

  const submit = async (label: string): Promise<boolean> => {
    if (label === target.label) return true
    try {
      await update.mutateAsync({ id: target.entryId, label })
      return true
    } catch (e) {
      notify('error', t(`errors:${e instanceof AppError ? e.code : 'UNKNOWN'}`))
      // 条目在对话框打开期间已被删除：无法重试，关闭对话框（错误已提示）
      return e instanceof AppError && e.code === 'ENTRY_NOT_FOUND'
    }
  }

  return (
    <NameDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('explorer:renameTitle')}
      description={t('explorer:renameDescription')}
      fieldLabel={t('explorer:name')}
      submitLabel={t('explorer:save')}
      initialValue={target.label}
      onSubmit={submit}
      finalFocus={finalFocus}
    />
  )
}
