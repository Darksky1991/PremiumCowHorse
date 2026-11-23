import type { JSX, ReactNode } from 'react'
import { SearchIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from 'cn'
import { Button } from '@pch/ui/components/button'
import { Kbd, KbdGroup } from '@pch/ui/components/kbd'
import { LogoMark } from '@pch/ui/logo-mark'
import { getBootstrap } from '@renderer/lib/ipc'
import { useUiStore } from '@renderer/stores/ui-store'
import { LanguageMenu } from './language-menu'
import { ThemeMenu } from './theme-menu'
import { WindowControls } from './window-controls'

/**
 * 自绘标题栏（隐藏系统标题栏）。整条可拖动（双击最大化 / 还原由系统处理），交互元素标记 app-no-drag。
 * Windows / Linux 在右端绘制自己的窗口按钮；macOS 使用系统红绿灯，左侧留出其位置。
 */
export function TitleBar({ workspaceSwitcher }: { workspaceSwitcher: ReactNode }): JSX.Element {
  const { t } = useTranslation()
  const setPaletteOpen = useUiStore((s) => s.setPaletteOpen)
  const isMac = getBootstrap()?.platform === 'darwin'

  return (
    <header
      className={cn(
        'app-drag flex h-9 shrink-0 items-center gap-1 border-b bg-sidebar text-sidebar-foreground',
        isMac ? 'pr-2 pl-20' : 'pl-2'
      )}
    >
      <LogoMark className="mx-1 size-4 shrink-0" />
      <span className="mr-2 text-[13px] font-semibold tracking-tight">{t('appName')}</span>

      {workspaceSwitcher}

      <div className="flex min-w-0 flex-1 justify-center px-4">
        <Button
          variant="outline"
          size="sm"
          className="app-no-drag w-full max-w-md justify-between bg-background font-normal text-muted-foreground"
          onClick={() => setPaletteOpen(true)}
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
      {isMac ? null : <WindowControls />}
    </header>
  )
}
