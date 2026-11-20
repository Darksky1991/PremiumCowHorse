import { useEffect, useRef, useState, type JSX } from 'react'
import { TriangleAlertIcon } from 'lucide-react'
import type { PreviewProps, WebNotice, WebPageState } from '@pch/plugin-sdk'
import { Button } from '@pch/ui/components/button'

/** 被阻止的动作的提示在状态行停留的时间 */
const NOTICE_MS = 5000

const NOTICE_KEYS: Record<WebNotice, string> = {
  outOfScope: 'noticeOutOfScope',
  download: 'noticeDownload',
  unsupported: 'noticeUnsupported'
}

/**
 * Markdown：占位元素（宿主把本标签的浏览器视图贴在它的位置上，视图加载 `<文件>?pch-view=markdown` 的外壳页；
 * 弹出层 / toast 出现时显示截图）+ 一行状态（标题、加载中、失败与「再試行」、被阻止的动作的提示）。
 * 加载失败时解除占位（视图隐藏），此时地址栏的刷新 / F5 由插件自己订阅并重新加载。
 */
export default function MarkdownPreview({ resource, host }: PreviewProps): JSX.Element {
  const { web } = host
  const { t, describeError } = host.i18n
  const placeholder = useRef<HTMLDivElement>(null)
  const [state, setState] = useState<WebPageState | null>(null)
  const [notice, setNotice] = useState<{ notice: WebNotice; seq: number } | null>(null)
  const failed = state?.failed ?? null

  useEffect(() => web.onState(setState), [web])
  useEffect(() => {
    let seq = 0
    return web.onNotice((n) => setNotice({ notice: n, seq: ++seq }))
  }, [web])
  useEffect(() => {
    if (notice === null) return
    const timer = setTimeout(() => setNotice(null), NOTICE_MS)
    return () => clearTimeout(timer)
  }, [notice])

  useEffect(() => {
    const element = placeholder.current
    if (element === null || failed !== null) return
    return web.attach(element, resource.uri, { view: 'markdown' })
  }, [web, resource.uri, failed])
  useEffect(
    () => (failed === null ? undefined : host.tabs.onRefresh(() => web.reload())),
    [host.tabs, web, failed]
  )

  const title = state?.title || resource.name
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div ref={placeholder} data-web-view className="min-h-0 flex-1" />
      <div
        data-status-bar
        className="flex h-8 shrink-0 items-center gap-3 border-t px-2 text-xs text-muted-foreground"
      >
        {notice !== null ? (
          <span
            role="status"
            className="flex min-w-0 items-center gap-1 text-amber-700 dark:text-amber-400"
          >
            <TriangleAlertIcon aria-hidden className="size-3.5 shrink-0" />
            <span className="truncate">{t(NOTICE_KEYS[notice.notice])}</span>
          </span>
        ) : failed !== null ? (
          <>
            <span role="alert" className="flex min-w-0 items-center gap-1">
              <TriangleAlertIcon aria-hidden className="size-3.5 shrink-0" />
              <span className="truncate">{t('failed', { reason: describeError(failed) })}</span>
            </span>
            <Button variant="outline" size="xs" onClick={() => web.reload()}>
              {t('retry')}
            </Button>
          </>
        ) : (
          <span className="min-w-0 truncate" title={title} data-page-title>
            {state === null || state.loading ? t('loading') : title}
          </span>
        )}
      </div>
    </div>
  )
}
