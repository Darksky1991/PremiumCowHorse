import type { JSX, ReactNode } from 'react'
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
import type { SidebarView } from '@renderer/stores/ui-store'
import { notifyComingSoon } from '../coming-soon'

/**
 * 侧栏外框：内容（含标题行）由 app/ 注入的视图提供，视图可在标题行放置自己的操作按钮。
 * 资源树（工作区条目 + 真实目录）由 features/explorer 提供，远程连接列表在 M4 由 features/connections 提供。
 */
export function SideBar({ children }: { children: ReactNode }): JSX.Element {
  return (
    <aside className="flex h-full flex-col bg-sidebar text-sidebar-foreground">{children}</aside>
  )
}

/** 侧栏视图的空状态占位（尚无对应 feature 时使用） */
export function SidebarEmptyState({ view }: { view: SidebarView }): JSX.Element {
  const { t, i18n } = useTranslation()
  const isExplorer = view === 'explorer'
  const ns = isExplorer ? 'explorer' : 'connections'

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-9 shrink-0 items-center px-4 text-xs font-medium text-muted-foreground">
        {t(isExplorer ? 'explorer' : 'connections')}
      </div>
      <Empty className="min-h-0 flex-1 border-0">
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
    </div>
  )
}
