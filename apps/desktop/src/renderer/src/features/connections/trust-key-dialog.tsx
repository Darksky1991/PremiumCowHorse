import type { JSX } from 'react'
import { useTranslation } from 'react-i18next'
import type { ConnectionDto } from '@pch/shared'
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
import { useConnectionActions } from '@renderer/data/connections'
import { notify } from '@renderer/stores/messages-store'
import { errorText } from './error-text'
import { HostKeyDetails } from './host-key-prompt'

/**
 * 「信任新的密钥」：显示原来与新的指纹，确认后保存新密钥。
 * 行内按钮与编辑对话框共用（明确确认后才信任，设计 5.3）
 */
export function TrustKeyDialog({
  open,
  onOpenChange,
  connection
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  connection: ConnectionDto
}): JSX.Element {
  const { t } = useTranslation()
  const { trustHostKey } = useConnectionActions()
  const confirm = (): void =>
    trustHostKey.mutate(connection.id, {
      onSuccess: () => onOpenChange(false),
      onError: (e) => {
        notify('error', errorText(t, e))
        onOpenChange(false)
      }
    })
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('connections:trustTitle')}</AlertDialogTitle>
          <AlertDialogDescription>{t('connections:trustDescription')}</AlertDialogDescription>
        </AlertDialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1">
            <p className="text-xs font-medium">{t('connections:oldKey')}</p>
            {connection.hostKey ? (
              <HostKeyDetails hostKey={connection.hostKey} />
            ) : (
              <p className="text-xs text-muted-foreground">{t('connections:hostKeyNone')}</p>
            )}
          </div>
          {connection.presentedHostKey ? (
            <div className="grid gap-1">
              <p className="text-xs font-medium text-destructive">{t('connections:newKey')}</p>
              <HostKeyDetails hostKey={connection.presentedHostKey} />
            </div>
          ) : null}
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('connections:cancel')}</AlertDialogCancel>
          <AlertDialogAction disabled={trustHostKey.isPending} onClick={confirm}>
            {trustHostKey.isPending ? <Spinner data-icon="inline-start" aria-hidden /> : null}
            {t('connections:trustSubmit')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
