import type { JSX, RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { AppError } from '@pch/shared'
import { useEntryActions } from '@renderer/data/entries'
import { NameDialog } from './name-dialog'

export interface NewGroupDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspaceId: string
  /** 新分组的父分组（条目 id）；null 为工作区根部 */
  parentId: string | null
  finalFocus: RefObject<HTMLElement | null>
}

/** 新建分组：在分组上为子分组，在树空白处为根部分组；名称预填默认值 */
export function NewGroupDialog({
  open,
  onOpenChange,
  workspaceId,
  parentId,
  finalFocus
}: NewGroupDialogProps): JSX.Element {
  const { t } = useTranslation()
  const { add } = useEntryActions()

  const submit = async (label: string): Promise<boolean> => {
    try {
      await add.mutateAsync({ kind: 'group', workspaceId, parentId, label })
      return true
    } catch (e) {
      toast.error(t(`errors:${e instanceof AppError ? e.code : 'UNKNOWN'}`))
      return false
    }
  }

  return (
    <NameDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('explorer:newGroupTitle')}
      fieldLabel={t('explorer:groupName')}
      submitLabel={t('explorer:create')}
      initialValue={t('explorer:newGroupDefaultName')}
      onSubmit={submit}
      finalFocus={finalFocus}
    />
  )
}
