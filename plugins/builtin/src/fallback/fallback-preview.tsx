import type { JSX } from 'react'
import {
  CopyIcon,
  ExternalLinkIcon,
  FileIcon,
  FileTextIcon,
  FolderIcon,
  FolderOpenIcon
} from 'lucide-react'
import type { PreviewProps } from '@pch/plugin-sdk'
import { Button } from '@pch/ui/components/button'
import { formatBytes, formatDateTime } from './format'

/**
 * 文件信息（名称、位置、类型、大小、修改时间）与三个动作；所有访问都经 host。
 * 文件且文本插件可用时另有「作为文本查看」（按标签切换查看方式，导航离开后恢复）
 */
export default function FallbackPreview({ resource, host }: PreviewProps): JSX.Element {
  const { t, language } = host.i18n
  const isDirectory = resource.kind === 'directory'
  const Icon = isDirectory ? FolderIcon : FileIcon
  const size = formatBytes(resource.size, language)

  return (
    <div className="h-full overflow-auto">
      <section aria-label={t('name')} className="flex max-w-3xl flex-col gap-6 p-8">
        <div className="flex items-start gap-3">
          <Icon aria-hidden className="mt-0.5 size-8 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <h2 className="text-lg font-semibold break-all select-text">{resource.name}</h2>
            {isDirectory ? null : <p className="text-sm text-muted-foreground">{t('noPreview')}</p>}
          </div>
        </div>

        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
          <dt className="text-muted-foreground">{t('location')}</dt>
          <dd className="break-all select-text">{host.fs.toDisplayPath(resource.uri)}</dd>
          <dt className="text-muted-foreground">{t('kind')}</dt>
          <dd>{t(isDirectory ? 'kindDirectory' : 'kindFile')}</dd>
          {isDirectory ? null : (
            <>
              <dt className="text-muted-foreground">{t('size')}</dt>
              <dd className="select-text">
                {size.bytes === null
                  ? size.short
                  : t('sizeWithBytes', { short: size.short, bytes: size.bytes })}
              </dd>
            </>
          )}
          <dt className="text-muted-foreground">{t('modified')}</dt>
          <dd className="select-text">{formatDateTime(resource.mtime, language)}</dd>
        </dl>

        <div className="flex flex-wrap gap-2">
          <Button onClick={() => void host.system.openWithSystem(resource.uri)}>
            <ExternalLinkIcon data-icon="inline-start" />
            {t('openWithSystem')}
          </Button>
          <Button variant="outline" onClick={() => host.system.revealInOs(resource.uri)}>
            <FolderOpenIcon data-icon="inline-start" />
            {t('reveal')}
          </Button>
          <Button variant="outline" onClick={() => void host.system.copyPath(resource.uri)}>
            <CopyIcon data-icon="inline-start" />
            {t('copyPath')}
          </Button>
          {!isDirectory && host.tabs.canViewAs('text') ? (
            <Button variant="outline" onClick={() => host.tabs.viewAs('text')}>
              <FileTextIcon data-icon="inline-start" />
              {t('viewAsText')}
            </Button>
          ) : null}
        </div>
      </section>
    </div>
  )
}
