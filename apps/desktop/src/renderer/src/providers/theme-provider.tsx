import { useLayoutEffect, useSyncExternalStore, type JSX, type ReactNode } from 'react'
import { useSetting } from '@renderer/data/settings'
import { getBootstrap } from '@renderer/lib/ipc'
import { MotionConfig, reducedMotionMode } from '@pch/ui/lib/motion'

import { ThemeContext, type ResolvedTheme } from './theme-context'

const DARK_QUERY = '(prefers-color-scheme: dark)'
const subscribeSystemTheme = (onChange: () => void): (() => void) => {
  const mq = window.matchMedia(DARK_QUERY)
  mq.addEventListener('change', onChange)
  return () => mq.removeEventListener('change', onChange)
}

/**
 * 自行实现的 ThemeProvider（约 50 行），不使用 next-themes：
 * 主题以 SQLite 中的设置为唯一来源。设置加载前先用 bootstrap 数据，避免首帧闪烁。
 * 明暗 → <html class="dark">，配色主题 → data-theme（default 不设），强调色 → data-accent，密度 → data-density。
 * 根部包 MotionConfig，按「減少動効」设置统一控制 motion 动画。
 */
export function ThemeProvider({ children }: { children: ReactNode }): JSX.Element {
  const bootstrap = getBootstrap()
  const mode = useSetting('appearance.themeMode')
  const themeName = useSetting('appearance.theme') ?? bootstrap?.themeName ?? 'default'
  const reduceMotion = useSetting('appearance.reduceMotion') ?? 'system'
  const accent = useSetting('appearance.accent') ?? bootstrap?.accent ?? 'neutral'
  const density = useSetting('appearance.density') ?? bootstrap?.density ?? 'comfortable'
  const systemDark = useSyncExternalStore(
    subscribeSystemTheme,
    () => window.matchMedia(DARK_QUERY).matches,
    () => bootstrap?.theme === 'dark'
  )

  const resolved: ResolvedTheme =
    mode === undefined
      ? (bootstrap?.theme ?? 'light')
      : mode === 'system'
        ? systemDark
          ? 'dark'
          : 'light'
        : mode

  useLayoutEffect(() => {
    const el = document.documentElement
    el.classList.toggle('dark', resolved === 'dark')
    el.style.colorScheme = resolved
    if (themeName === 'default') delete el.dataset.theme
    else el.dataset.theme = themeName
    el.dataset.accent = accent
    el.dataset.density = density
  }, [resolved, themeName, accent, density])

  return (
    <ThemeContext.Provider value={resolved}>
      <MotionConfig reducedMotion={reducedMotionMode(reduceMotion)}>{children}</MotionConfig>
    </ThemeContext.Provider>
  )
}
