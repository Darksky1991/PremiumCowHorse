import { useState, type JSX } from 'react'
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
import { trustFailure, trustKeyInput } from './trust-key'

/**
 * 「信任新的密钥」：显示原来与新的指纹，确认后保存新密钥。
 * 行内按钮与编辑对话框共用（明确确认后才信任，设计 5.3）。connection 须是列表中的最新值：
 * 信任的是这里显示的密钥（I4）；确认框打开之后服务器又出示了别的密钥时主进程拒绝，
 * 确认框留着、提示密钥变了，并显示刷新后的新密钥
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
  /** 上一次信任被拒绝：服务器出示的密钥已不是当时显示的那个 */
  const [stale, setStale] = useState(false)
  const input = trustKeyInput(connection)
  const changeOpen = (next: boolean): void => {
    if (next) setStale(false)
    onOpenChange(next)
  }
  const confirm = (): void => {
    if (input === null) return
    trustHostKey.mutate(input, {
      onSuccess: () => changeOpen(false),
      onError: (e) => {
        if (trustFailure(e) === 'stale') {
          setStale(true)
          return
        }
        notify('error', errorText(t, e))
        changeOpen(false)
      }
    })
  }
  return (
    <AlertDialog open={open} onOpenChange={changeOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('connections:trustTitle')}</AlertDialogTitle>
          <AlertDialogDescription>{t('connections:trustDescription')}</AlertDialogDescription>
        </AlertDialogHeader>
        {stale ? (
          <p role="alert" className="text-xs text-destructive">
            {t('connections:trustKeyStale')}
          </p>
        ) : null}
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
          <AlertDialogAction disabled={trustHostKey.isPending || input === null} onClick={confirm}>
            {trustHostKey.isPending ? <Spinner data-icon="inline-start" aria-hidden /> : null}
            {t('connections:trustSubmit')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
