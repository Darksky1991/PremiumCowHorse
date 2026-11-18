import { useLayoutEffect, useSyncExternalStore, type JSX, type ReactNode } from 'react'
import { useSetting } from '@renderer/data/settings'
import { getBootstrap } from '@renderer/lib/ipc'

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
 * 明暗 → <html class="dark">，强调色 → data-accent，密度 → data-density。
 */
export function ThemeProvider({ children }: { children: ReactNode }): JSX.Element {
  const bootstrap = getBootstrap()
  const mode = useSetting('appearance.themeMode')
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
    el.dataset.accent = accent
    el.dataset.density = density
  }, [resolved, accent, density])

  return <ThemeContext.Provider value={resolved}>{children}</ThemeContext.Provider>
}
