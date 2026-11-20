import type { JSX } from 'react'
import { FolderTreeIcon, SearchIcon, ServerIcon, SettingsIcon, type LucideIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from 'cn'
import { Button } from '@pch/ui/components/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@pch/ui/components/tooltip'
import { useUiStore, type SidebarView } from '@renderer/stores/ui-store'
import { notifyComingSoon } from '../coming-soon'

const VIEWS: { view: SidebarView; icon: LucideIcon; labelKey: string }[] = [
  { view: 'explorer', icon: FolderTreeIcon, labelKey: 'explorer' },
  { view: 'search', icon: SearchIcon, labelKey: 'search:title' },
  { view: 'connections', icon: ServerIcon, labelKey: 'connections' }
]

/** 活动栏：切换侧栏内容；再次点击当前项折叠侧栏 */
export function ActivityBar(): JSX.Element {
  const { t, i18n } = useTranslation()
  const { sidebarView, sidebarCollapsed, activateView } = useUiStore()

  return (
    <nav
      aria-label={t('explorer')}
      className="flex w-12 shrink-0 flex-col items-center gap-1 border-r bg-sidebar py-2"
    >
      {VIEWS.map(({ view, icon, labelKey }) => (
        <ActivityItem
          key={view}
          icon={icon}
          label={t(labelKey)}
          active={!sidebarCollapsed && sidebarView === view}
          onClick={() => activateView(view)}
        />
      ))}
      <div className="flex-1" />
      <ActivityItem
        icon={SettingsIcon}
        label={t('settings')}
        onClick={() => notifyComingSoon(i18n)}
      />
    </nav>
  )
}

function ActivityItem({
  icon: Icon,
  label,
  active,
  onClick
}: {
  icon: LucideIcon
  label: string
  active?: boolean
  onClick: () => void
}): JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            aria-label={label}
            aria-pressed={active}
            onClick={onClick}
            className={cn(
              'relative text-muted-foreground',
              // 左侧细条标示当前视图
              active &&
                'text-foreground before:absolute before:inset-y-2 before:-left-1.5 before:w-0.5 before:rounded-full before:bg-primary'
            )}
          />
        }
      >
        <Icon />
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  )
}
