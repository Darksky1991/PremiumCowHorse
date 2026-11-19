import type { JSX } from 'react'
import { useTranslation } from 'react-i18next'
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

export interface ConfirmExecutableDialogProps {
  open: boolean
  /** 文件名（关闭动画期间保持上一次的名称） */
  name: string
  /** 确认为 true；取消、Esc、点击遮罩为 false */
  onResult: (confirmed: boolean) => void
}

/** 「用系统应用打开」可执行类文件前的确认（设计 3.3）。初始焦点在第一个按钮「取消」上 */
export function ConfirmExecutableDialog({
  open,
  name,
  onResult
}: ConfirmExecutableDialogProps): JSX.Element {
  const { t } = useTranslation('preview')
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onResult(false)
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('confirmTitle', { name })}</AlertDialogTitle>
          <AlertDialogDescription>{t('confirmDescription')}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={() => onResult(true)}>
            {t('confirmOpen')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
