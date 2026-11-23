import { useEffect, type JSX } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { AppError } from '@pch/shared'
import { notify } from '@renderer/stores/messages-store'
import { startSettingsWriteWatch } from './settings-write-watch'

/** 不渲染任何内容；挂在 app.tsx。设置写入失败时 toast（乐观值已由 data/settings 回滚） */
export function SettingsWriteNotice(): JSX.Element | null {
  const client = useQueryClient()
  const { t } = useTranslation(['settings', 'errors'])
  useEffect(
    () =>
      startSettingsWriteWatch(client, (e) => {
        const reason = t(`errors:${e instanceof AppError ? e.code : 'UNKNOWN'}`)
        notify('error', t('settings:saveFailed', { reason }))
      }),
    [client, t]
  )
  return null
}
