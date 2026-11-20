import type { JSX, ReactNode } from 'react'
import { ChevronDownIcon, TriangleAlertIcon } from 'lucide-react'
import type { DocEncoding, DocumentInfo, PreviewHost } from '@pch/plugin-sdk'
import { Button } from '@pch/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@pch/ui/components/dropdown-menu'
import { AUTO, ENCODING_OPTIONS, encodingName } from './encoding-options'
import { formatCount, formatSize } from './format'

export interface StatusBarProps {
  host: PreviewHost
  info: DocumentInfo
  /** 可见行中有含 U+FFFD 的行 */
  replaced: boolean
  /** 可见行中有被截断的行 */
  truncated: boolean
  indexError: string | null
  readError: string | null
  onEncoding(label: DocEncoding | null): void
  onReadAll(): void
}

/**
 * 状态栏（设计 3.5）：编码下拉（自动 + 9 个标签）与提示（推测 / 可能乱码 / 二进制 / 截断 / 读取错误）、
 * 行数或索引进度、大小、部分模式（「仅显示末尾 4MB / 共 N」+「读取全部」）
 */
export function StatusBar(props: StatusBarProps): JSX.Element {
  const { host, info, replaced, truncated, indexError, readError } = props
  const { t, language, describeError } = host.i18n
  const { index, encoding } = info
  const span = info.window.end - info.window.start
  const percent =
    span > 0 ? Math.floor((100 * Math.max(0, index.indexedTo - info.window.start)) / span) : 100
  const lines = formatCount(index.lines, language)

  return (
    <div
      data-status-bar
      className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-t px-2 py-1 text-xs text-muted-foreground"
    >
      <EncodingMenu host={host} info={info} onEncoding={props.onEncoding} />
      {encoding.confidence === 'guess' ? <Hint>{t('encodingGuess')}</Hint> : null}
      {replaced ? <Hint>{t('mayBeGarbled')}</Hint> : null}
      {info.binary ? <Hint>{t('binaryHint')}</Hint> : null}
      {truncated ? <Hint>{t('truncatedHint')}</Hint> : null}
      {indexError !== null ? (
        <Hint>{t('indexFailed', { reason: describeError(indexError) })}</Hint>
      ) : null}
      {readError !== null ? <Hint>{readError}</Hint> : null}
      <span className="ms-auto" data-lines>
        {index.complete ? t('lineCount', { lines }) : t('indexing', { percent, lines })}
      </span>
      {info.mode === 'partial' ? (
        <span className="flex items-center gap-2">
          {t(info.window.start === 0 ? 'partialHead' : 'partialTail', {
            window: formatSize(span, language),
            size: formatSize(info.size, language)
          })}
          <Button variant="outline" size="xs" onClick={props.onReadAll}>
            {t('readAll')}
          </Button>
        </span>
      ) : (
        <span>{formatSize(info.size, language)}</span>
      )}
    </div>
  )
}

function Hint({ children }: { children: ReactNode }): JSX.Element {
  return (
    <span className="flex items-center gap-1 text-amber-700 dark:text-amber-400">
      <TriangleAlertIcon aria-hidden className="size-3.5" />
      {children}
    </span>
  )
}

function EncodingMenu({
  host,
  info,
  onEncoding
}: Pick<StatusBarProps, 'host' | 'info' | 'onEncoding'>): JSX.Element {
  const { t } = host.i18n
  const { label, manual } = info.encoding
  const name = encodingName(label)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="ghost" size="xs" aria-label={`${t('encoding')}: ${name}`} />}
      >
        {manual ? name : t('encodingAutoDetected', { name })}
        <ChevronDownIcon data-icon="inline-end" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel>{t('encoding')}</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={manual ? label : AUTO}
            onValueChange={(value: string) =>
              onEncoding(value === AUTO ? null : (value as DocEncoding))
            }
          >
            <DropdownMenuRadioItem value={AUTO} closeOnClick>
              {t('encodingAuto')}
            </DropdownMenuRadioItem>
            <DropdownMenuSeparator />
            {ENCODING_OPTIONS.map((o) => (
              <DropdownMenuRadioItem key={o.label} value={o.label} closeOnClick>
                {o.name}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
