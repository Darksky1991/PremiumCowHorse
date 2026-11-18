import type { JSX } from 'react'
import { useQuery } from '@tanstack/react-query'
import { CircleCheckIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { Language } from '@pch/shared'
import { call } from '@renderer/lib/ipc'
import { queryKeys } from '@renderer/lib/query-keys'
import { LANGUAGE_NAMES } from '../languages'

/**
 * 状态栏。M4 起左侧显示远程连接状态，M2 起中间显示当前资源路径、编码与插件状态项。
 */
export function StatusBar(): JSX.Element {
  const { t, i18n } = useTranslation()
  const { data: info } = useQuery({
    queryKey: queryKeys.appInfo,
    queryFn: () => call('app.getInfo', undefined)
  })

  return (
    <footer className="flex h-6 shrink-0 items-center justify-between gap-4 border-t bg-sidebar px-3 text-xs text-muted-foreground">
      <span className="flex items-center gap-1.5">
        <CircleCheckIcon className="size-3.5" aria-hidden />
        {t('ready')}
      </span>
      <span className="flex items-center gap-4">
        <span>{LANGUAGE_NAMES[i18n.language as Language] ?? i18n.language}</span>
        {info ? (
          <span title={`Electron ${info.electron} / Chromium ${info.chrome} / Node ${info.node}`}>
            v{info.version}
          </span>
        ) : null}
      </span>
    </footer>
  )
}
