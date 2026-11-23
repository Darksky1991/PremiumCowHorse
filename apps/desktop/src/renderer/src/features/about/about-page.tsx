import type { JSX } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import type { AppInfo, TabState } from '@pch/shared'
import { Button } from '@pch/ui/components/button'
import { LogoMark } from '@pch/ui/logo-mark'
import { call } from '@renderer/lib/ipc'
import { queryKeys } from '@renderer/lib/query-keys'
import { notify } from '@renderer/stores/messages-store'

export interface AboutPageProps {
  /** 显示关于页（kind 为 about，uri 为 pch-about:）的标签 */
  tab: TabState
}

/**
 * 诊断信息：只含版本与平台字段（不含路径、用户名等个人信息）。
 * 一行一项，便于粘贴到工单
 */
function diagnosticsText(info: AppInfo): string {
  return [
    `name: ${info.name}`,
    `version: ${info.version}`,
    `electron: ${info.electron}`,
    `chrome: ${info.chrome}`,
    `node: ${info.node}`,
    `platform: ${info.platform}`,
    `arch: ${info.arch}`
  ].join('\n')
}

/**
 * 关于页（M5，设计 devDoc/2026-11-23-42 第 5.F 节）：logo、产品名、版本与运行环境、
 * 数据 / 日志目录（只显示）与三个按钮。打开目录由主进程按固定路径执行（system.openAppFolder）
 */
// 标签本身目前不携带页面状态（单页、无参数），props 只为与其他内置页的 render 约定一致
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function AboutPage(_props: AboutPageProps): JSX.Element {
  const { t } = useTranslation('about')
  const { data: info } = useQuery({
    queryKey: queryKeys.appInfo,
    queryFn: () => call('app.getInfo', undefined)
  })

  const open = (which: 'logs' | 'userData'): void => {
    call('system.openAppFolder', { which }).catch(() => notify('error', t('openFailed')))
  }
  const copy = (): void => {
    if (!info) return
    call('system.copyText', { text: diagnosticsText(info) })
      .then(() => notify('success', t('copied')))
      .catch(() => notify('error', t('copyFailed')))
  }

  const rows: Array<[string, string]> = info
    ? [
        [t('version'), `v${info.version}`],
        [t('electron'), info.electron],
        [t('chromium'), info.chrome],
        [t('node'), info.node],
        [t('platform'), `${info.platform} (${info.arch})`],
        [t('dataDir'), info.userDataDir],
        [t('logsDir'), info.logsDir]
      ]
    : []

  return (
    <div className="flex h-full flex-col items-center overflow-auto p-8">
      <div className="flex w-full max-w-xl flex-col gap-6">
        <header className="flex items-center gap-4">
          <LogoMark className="size-16 shrink-0" />
          <div>
            <h1 className="text-xl font-semibold">{info?.name ?? ''}</h1>
            {info ? <p className="text-sm text-muted-foreground">v{info.version}</p> : null}
          </div>
        </header>
        <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm">
          {rows.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="break-all select-text">{value}</dd>
            </div>
          ))}
        </dl>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => open('logs')}>
            {t('openLogs')}
          </Button>
          <Button variant="outline" onClick={() => open('userData')}>
            {t('openData')}
          </Button>
          <Button variant="outline" disabled={!info} onClick={copy}>
            {t('copyDiagnostics')}
          </Button>
        </div>
      </div>
    </div>
  )
}
