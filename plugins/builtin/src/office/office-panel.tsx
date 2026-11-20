import { useCallback, useEffect, useState, type JSX } from 'react'
import {
  CopyIcon,
  ExternalLinkIcon,
  FileSpreadsheetIcon,
  FolderOpenIcon,
  LoaderCircleIcon,
  RefreshCwIcon
} from 'lucide-react'
import type { LaunchCapabilities, LaunchMode, PreviewProps } from '@pch/plugin-sdk'
import { Button } from '@pch/ui/components/button'
import { formatBytes, formatDateTime } from './format'

const MODE_KEYS: Record<LaunchMode, string> = {
  readOnly: 'modeReadOnly',
  edit: 'modeEdit',
  newFromFile: 'modeNewFromFile',
  protectedView: 'modeProtectedView'
}

/**
 * Office 启动面板（设计 5.6.3）：文件信息 + 按检测到的方式（options 的顺序）启动本机 Office。
 * 单击 / 双击 Office 文件都先显示本面板，不直接启动。启动中按钮禁用并显示「起動中」（Promise 结束即恢复）。
 * 检测不到任何方式时只有「既定のアプリで開く」。插件只看 mode，不关心 via。
 */
export default function OfficePanel({ resource, host }: PreviewProps): JSX.Element {
  const { t, language } = host.i18n
  // undefined：检测中；null：检测失败（宿主已提示）
  const [caps, setCaps] = useState<LaunchCapabilities | null | undefined>(undefined)
  const [launching, setLaunching] = useState<LaunchMode | null>(null)
  const [detectRun, setDetectRun] = useState(0)

  useEffect(() => {
    let cancelled = false
    void host.system.getLaunchCapabilities(resource.uri).then((c) => {
      if (!cancelled) setCaps(c)
    })
    return () => {
      cancelled = true
    }
  }, [host, resource.uri, detectRun])

  const launch = useCallback(
    async (mode: LaunchMode) => {
      setLaunching(mode)
      try {
        await host.system.launch(resource.uri, mode)
      } finally {
        setLaunching(null)
      }
    },
    [host, resource.uri]
  )

  const redetect = useCallback(async () => {
    setCaps(undefined)
    await host.system.redetectLaunchCapabilities()
    setDetectRun((n) => n + 1)
  }, [host])

  const size = formatBytes(resource.size, language)
  // 检测可能给出空串：按没有应用名处理
  const appName = caps?.appName?.trim() ?? ''
  const options = caps?.options ?? []

  return (
    <div className="h-full overflow-auto">
      <section aria-label={t('name')} className="flex max-w-3xl flex-col gap-6 p-8">
        <div className="flex items-start gap-3">
          <FileSpreadsheetIcon
            aria-hidden
            className="mt-0.5 size-8 shrink-0 text-muted-foreground"
          />
          <h2 className="min-w-0 text-lg font-semibold break-all select-text">{resource.name}</h2>
        </div>

        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
          <dt className="text-muted-foreground">{t('location')}</dt>
          <dd className="break-all select-text">{host.fs.toDisplayPath(resource.uri)}</dd>
          <dt className="text-muted-foreground">{t('size')}</dt>
          <dd className="select-text">
            {size.bytes === null
              ? size.short
              : t('sizeWithBytes', { short: size.short, bytes: size.bytes })}
          </dd>
          <dt className="text-muted-foreground">{t('modified')}</dt>
          <dd className="select-text">{formatDateTime(resource.mtime, language)}</dd>
        </dl>

        {caps === undefined ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <LoaderCircleIcon aria-hidden className="size-4 animate-spin" />
            {t('detecting')}
          </p>
        ) : options.length > 0 ? (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-muted-foreground">
              {appName ? t('openWithApp', { app: appName }) : t('openWithAssociated')}
            </p>
            <div className="flex flex-wrap gap-2">
              {options.map((o, i) => (
                <Button
                  key={o.mode}
                  variant={i === 0 ? 'default' : 'outline'}
                  disabled={launching !== null}
                  onClick={() => void launch(o.mode)}
                >
                  {launching === o.mode ? (
                    <LoaderCircleIcon data-icon="inline-start" className="animate-spin" />
                  ) : null}
                  {launching === o.mode
                    ? `${t(MODE_KEYS[o.mode])} (${t('launching')})`
                    : t(MODE_KEYS[o.mode])}
                </Button>
              ))}
            </div>
          </div>
        ) : (
          <div>
            <Button onClick={() => void host.system.openWithSystem(resource.uri)}>
              <ExternalLinkIcon data-icon="inline-start" />
              {t('openWithDefault')}
            </Button>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => host.system.revealInOs(resource.uri)}>
            <FolderOpenIcon data-icon="inline-start" />
            {t('reveal')}
          </Button>
          <Button variant="outline" onClick={() => void host.system.copyPath(resource.uri)}>
            <CopyIcon data-icon="inline-start" />
            {t('copyPath')}
          </Button>
          <Button variant="outline" disabled={caps === undefined} onClick={() => void redetect()}>
            <RefreshCwIcon data-icon="inline-start" />
            {t('redetect')}
          </Button>
        </div>
      </section>
    </div>
  )
}
