import type { JSX } from 'react'
import { ArrowDownToLineIcon, ArrowUpToLineIcon, ChevronsDownIcon } from 'lucide-react'
import type { PreviewHost } from '@pch/plugin-sdk'
import { Button } from '@pch/ui/components/button'

export interface ToolbarProps {
  host: PreviewHost
  follow: boolean
  onStart(): void
  onEnd(): void
  onFollow(follow: boolean): void
}

/** 工具栏：开头 / 末尾 / 跟随末尾（切换按钮，aria-pressed） */
export function Toolbar({ host, follow, onStart, onEnd, onFollow }: ToolbarProps): JSX.Element {
  const { t } = host.i18n
  return (
    <div
      role="toolbar"
      aria-label={t('toolbarLabel')}
      className="flex shrink-0 items-center gap-1 border-b px-2 py-1"
    >
      <Button variant="ghost" size="xs" onClick={onStart}>
        <ArrowUpToLineIcon data-icon="inline-start" />
        {t('toStart')}
      </Button>
      <Button variant="ghost" size="xs" onClick={onEnd}>
        <ArrowDownToLineIcon data-icon="inline-start" />
        {t('toEnd')}
      </Button>
      <Button
        variant={follow ? 'secondary' : 'ghost'}
        size="xs"
        aria-pressed={follow}
        onClick={() => onFollow(!follow)}
      >
        <ChevronsDownIcon data-icon="inline-start" />
        {t('follow')}
      </Button>
    </div>
  )
}
