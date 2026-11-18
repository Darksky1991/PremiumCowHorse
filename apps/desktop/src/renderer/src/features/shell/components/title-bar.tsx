import type { JSX } from 'react'
import { CheckIcon, ChevronDownIcon, PlusIcon, SearchIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@pch/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@pch/ui/components/dropdown-menu'
import { Kbd, KbdGroup } from '@pch/ui/components/kbd'
import { notifyComingSoon } from '../coming-soon'
import { LanguageMenu } from './language-menu'
import { ThemeMenu } from './theme-menu'

/**
 * 自绘标题栏（无边框窗口）。整条可拖动，交互元素标记 app-no-drag。
 * 左右留白使用 Window Controls Overlay 的 env() 变量，自动避开
 * Windows 的原生窗口按钮与 macOS 的红绿灯。
 */
export function TitleBar(): JSX.Element {
  const { t, i18n } = useTranslation()

  return (
    <header
      className="app-drag flex h-9 shrink-0 items-center gap-1 border-b bg-sidebar text-sidebar-foreground"
      style={{
        paddingLeft: 'calc(env(titlebar-area-x, 0px) + 0.5rem)',
        paddingRight:
          'calc(100vw - env(titlebar-area-width, 100vw) - env(titlebar-area-x, 0px) + 0.5rem)'
      }}
    >
      <AppMark />
      <span className="mr-2 text-[13px] font-semibold tracking-tight">{t('appName')}</span>

      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="sm"
              className="app-no-drag text-muted-foreground"
              aria-label={t('workspace')}
            />
          }
        >
          {t('defaultWorkspace')}
          <ChevronDownIcon data-icon="inline-end" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          <DropdownMenuGroup>
            <DropdownMenuLabel>{t('workspace')}</DropdownMenuLabel>
            <DropdownMenuItem>
              <CheckIcon />
              {t('defaultWorkspace')}
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem onClick={() => notifyComingSoon(i18n)}>
              <PlusIcon />
              {t('welcome:newWorkspace')}
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      <div className="flex min-w-0 flex-1 justify-center px-4">
        <Button
          variant="outline"
          size="sm"
          className="app-no-drag w-full max-w-md justify-between bg-background font-normal text-muted-foreground"
          onClick={() => notifyComingSoon(i18n)}
        >
          <span className="flex min-w-0 items-center gap-2">
            <SearchIcon data-icon="inline-start" />
            <span className="truncate">{t('search')}</span>
          </span>
          <KbdGroup>
            <Kbd>Ctrl</Kbd>
            <Kbd>K</Kbd>
          </KbdGroup>
        </Button>
      </div>

      <ThemeMenu />
      <LanguageMenu />
    </header>
  )
}

/** 应用标识：叠放的两张卡片，寓意「把一个案件的资料收在一处」 */
function AppMark(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" className="mx-1 size-4 shrink-0 text-primary" aria-hidden>
      <rect
        x="1.5"
        y="4.5"
        width="10"
        height="10"
        rx="2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path
        d="M4.5 1.5h8a2 2 0 0 1 2 2v8"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  )
}
