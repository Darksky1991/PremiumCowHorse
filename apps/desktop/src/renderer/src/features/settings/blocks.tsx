import { useState, type JSX, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { XIcon } from 'lucide-react'
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
import { Button } from '@pch/ui/components/button'
import { useCacheInfo, useClearCache } from '@renderer/data/settings'
import { notify } from '@renderer/stores/messages-store'

/** 一个不是单个设置键的块：与 SettingRow 同样的行布局 */
function BlockRow({
  title,
  desc,
  children
}: {
  title: string
  desc?: string
  children: ReactNode
}): JSX.Element {
  return (
    <div className="flex items-start justify-between gap-6 border-b py-4 last:border-b-0">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">{title}</div>
        {desc ? <p className="mt-0.5 text-[13px] text-muted-foreground">{desc}</p> : null}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">{children}</div>
    </div>
  )
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let i = 0
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024
    i += 1
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[i]}`
}

/** 缓存占用与「キャッシュを消去」（确认框）；缓存只是可重建的副本，不涉及磁盘上的文件 */
export function CacheBlock(): JSX.Element {
  const { t } = useTranslation('settings')
  const info = useCacheInfo()
  const clear = useClearCache()
  const [confirming, setConfirming] = useState(false)

  const usage = info.isPending
    ? t('cache.usageLoading')
    : info.data
      ? formatBytes(info.data.bytes)
      : t('cache.usageUnavailable')

  return (
    <BlockRow title={t('cache.usage')}>
      <div className="flex items-center gap-3">
        <span data-testid="cache-usage" className="text-sm tabular-nums">
          {usage}
        </span>
        <Button variant="outline" size="sm" onClick={() => setConfirming(true)}>
          {t('cache.clear')}
        </Button>
      </div>
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('cache.confirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('cache.confirmDesc')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('cache.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                clear.mutate(undefined, {
                  onSuccess: () => notify('success', t('cache.cleared')),
                  onError: () => notify('error', t('cache.clearFailed'))
                })
              }
            >
              {t('cache.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </BlockRow>
  )
}

/** 文件关联（扩展名 → 预览插件）列表，可删除单条 */
export function AssociationsBlock({
  associations,
  onChange
}: {
  associations: Record<string, string>
  onChange: (next: Record<string, string>) => void
}): JSX.Element {
  const { t } = useTranslation('settings')
  const entries = Object.entries(associations).sort(([a], [b]) => a.localeCompare(b))
  return (
    <BlockRow title={t('associations.title')} desc={t('associations.desc')}>
      {entries.length === 0 ? (
        <span className="text-sm text-muted-foreground">{t('associations.empty')}</span>
      ) : (
        <ul className="flex w-72 flex-col gap-1">
          {entries.map(([ext, plugin]) => (
            <li
              key={ext}
              className="flex items-center justify-between gap-2 rounded-md border px-2 py-1 text-sm"
            >
              <span className="font-mono">.{ext}</span>
              <span className="min-w-0 flex-1 truncate text-right text-[13px] text-muted-foreground">
                {plugin}
              </span>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={t('associations.remove', { ext: `.${ext}` })}
                onClick={() => {
                  onChange(Object.fromEntries(entries.filter(([e]) => e !== ext)))
                }}
              >
                <XIcon />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </BlockRow>
  )
}

/** 隐私：「最近使用を消去」只留按钮位置（Task 9 接线） */
export function PrivacyBlock(): JSX.Element {
  const { t } = useTranslation('settings')
  return (
    <BlockRow title={t('privacy.recentTitle')} desc={t('privacy.recentDesc')}>
      <>
        <Button variant="outline" size="sm" disabled>
          {t('privacy.clearRecent')}
        </Button>
        <p className="text-xs text-muted-foreground">{t('privacy.soon')}</p>
      </>
    </BlockRow>
  )
}
