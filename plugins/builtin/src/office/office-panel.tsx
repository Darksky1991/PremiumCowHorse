import { useCallback, useEffect, useState, type JSX } from 'react'
import {
  CopyIcon,
  ExternalLinkIcon,
  FileSpreadsheetIcon,
  FileTextIcon,
  FolderOpenIcon,
  LoaderCircleIcon,
  PresentationIcon,
  RefreshCwIcon,
  type LucideIcon
} from 'lucide-react'
import type { LaunchCapabilities, LaunchMode, PreviewProps } from '@pch/plugin-sdk'
import { Button } from '@pch/ui/components/button'
import { capsForUri, formatBytes, formatDateTime, officeIconFor } from './format'

const ICONS: Record<ReturnType<typeof officeIconFor>, LucideIcon> = {
  word: FileTextIcon,
  excel: FileSpreadsheetIcon,
  powerpoint: PresentationIcon
}

/** 检测超过这个时间才显示「検出中」（命中缓存时 IPC 只要几毫秒，不显示就不会闪） */
const DETECTING_DELAY_MS = 300

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
  // 结果连同检测时的 uri 保存：uri 变化后 capsForUri 给出 undefined（检测中），不沿用上一个文件的结果
  // caps：undefined 检测中；null 宿主调用失败（宿主已提示）
  const [detected, setDetected] = useState<
    { uri: string; caps: LaunchCapabilities | null } | undefined
  >(undefined)
  const caps = capsForUri(detected, resource.uri)
  const [launching, setLaunching] = useState<LaunchMode | null>(null)
  const [openingDefault, setOpeningDefault] = useState(false)
  const [detectRun, setDetectRun] = useState(0)
  const [showDetecting, setShowDetecting] = useState(false)

  useEffect(() => {
    let cancelled = false
    const uri = resource.uri
    void host.system.getLaunchCapabilities(uri).then((c) => {
      if (!cancelled) setDetected({ uri, caps: c })
    })
    return () => {
      cancelled = true
    }
  }, [host, resource.uri, detectRun])

  useEffect(() => {
    if (caps !== undefined) return
    const timer = setTimeout(() => setShowDetecting(true), DETECTING_DELAY_MS)
    return () => {
      clearTimeout(timer)
      setShowDetecting(false)
    }
  }, [caps])

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

  const openWithDefault = useCallback(async () => {
    setOpeningDefault(true)
    try {
      await host.system.openWithSystem(resource.uri)
    } finally {
      setOpeningDefault(false)
    }
  }, [host, resource.uri])

  const redetect = useCallback(async () => {
    setDetected(undefined)
    await host.system.redetectLaunchCapabilities()
    setDetectRun((n) => n + 1)
  }, [host])

  const size = formatBytes(resource.size, language)
  // 检测可能给出空串：按没有应用名处理
  const appName = caps?.appName?.trim() ?? ''
  const options = caps?.options ?? []
  const detectFailed = caps?.detectFailed === true
  const busy = launching !== null || openingDefault
  const Icon = ICONS[officeIconFor(caps?.ext ?? extensionOf(resource.name))]

  return (
    <div className="h-full overflow-auto">
      <section aria-label={t('name')} className="flex max-w-3xl flex-col gap-6 p-8">
        <div className="flex items-start gap-3">
          <Icon aria-hidden className="mt-0.5 size-8 shrink-0 text-muted-foreground" />
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
          // 占住与按钮区域相近的高度（说明行 + 一排按钮），检测完成后下面的按钮不跳动
          <div className="flex min-h-[4.75rem] flex-col gap-2">
            {showDetecting ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <LoaderCircleIcon aria-hidden className="size-4 animate-spin" />
                {t('detecting')}
              </p>
            ) : null}
          </div>
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
          <div className="flex flex-col gap-2">
            {detectFailed ? (
              <p role="alert" className="text-sm text-muted-foreground">
                {t('detectFailed')}
              </p>
            ) : null}
            <div>
              <Button disabled={busy} onClick={() => void openWithDefault()}>
                {openingDefault ? (
                  <LoaderCircleIcon data-icon="inline-start" className="animate-spin" />
                ) : (
                  <ExternalLinkIcon data-icon="inline-start" />
                )}
                {openingDefault
                  ? `${t('openWithDefault')} (${t('launching')})`
                  : t('openWithDefault')}
              </Button>
            </div>
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
          <Button
            variant={detectFailed ? 'default' : 'outline'}
            disabled={caps === undefined || busy}
            onClick={() => void redetect()}
          >
            <RefreshCwIcon data-icon="inline-start" />
            {t('redetect')}
          </Button>
        </div>
      </section>
    </div>
  )
}

/** 文件名的小写扩展名（不含点）；没有为空串。检测结果到达前用它选图标 */
function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1) : ''
}
