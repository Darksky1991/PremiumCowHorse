import type { JSX } from 'react'
import { FolderPlusIcon, FolderTreeIcon, ServerIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@pch/ui/components/button'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle
} from '@pch/ui/components/empty'
import { useUiStore } from '@renderer/stores/ui-store'
import { notifyComingSoon } from '../coming-soon'

/**
 * 侧栏。资源树（工作区条目 + 真实目录）在 M1 由 features/explorer 提供，
 * 远程连接列表在 M4 由 features/connections 提供；M0 先显示空状态与入口。
 */
export function SideBar(): JSX.Element {
  const { t, i18n } = useTranslation()
  const view = useUiStore((s) => s.sidebarView)
  const isExplorer = view === 'explorer'
  const ns = isExplorer ? 'explorer' : 'connections'

  return (
    <aside className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      <div className="flex h-9 shrink-0 items-center px-4 text-xs font-medium text-muted-foreground">
        {isExplorer ? t('explorer') : t('connections')}
      </div>
      <Empty className="flex-1 border-0">
        <EmptyHeader>
          <EmptyMedia variant="icon">{isExplorer ? <FolderTreeIcon /> : <ServerIcon />}</EmptyMedia>
          <EmptyTitle>{t(`${ns}:emptyTitle`)}</EmptyTitle>
          <EmptyDescription>{t(`${ns}:emptyHint`)}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          {isExplorer ? (
            <Button size="sm" onClick={() => notifyComingSoon(i18n)}>
              <FolderPlusIcon data-icon="inline-start" />
              {t('explorer:addFolder')}
            </Button>
          ) : null}
          <Button size="sm" variant="outline" onClick={() => notifyComingSoon(i18n)}>
            <ServerIcon data-icon="inline-start" />
            {t('explorer:addConnection')}
          </Button>
        </EmptyContent>
      </Empty>
    </aside>
  )
}
