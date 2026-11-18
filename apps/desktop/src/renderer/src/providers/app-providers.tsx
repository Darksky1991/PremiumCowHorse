import { useEffect, useState, type JSX, type ReactNode } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from '@pch/ui/components/sonner'
import { TooltipProvider } from '@pch/ui/components/tooltip'
import { getBridge } from '@renderer/lib/ipc'
import { bridgeMainEvents, createQueryClient } from '@renderer/lib/query-client'
import { I18nProvider } from './i18n-provider'
import { useResolvedTheme } from './theme-context'
import { ThemeProvider } from './theme-provider'

export function AppProviders({ children }: { children: ReactNode }): JSX.Element {
  if (!getBridge()) return <NotInElectron />
  return <RuntimeProviders>{children}</RuntimeProviders>
}

function RuntimeProviders({ children }: { children: ReactNode }): JSX.Element {
  const [queryClient] = useState(createQueryClient)
  useEffect(() => bridgeMainEvents(queryClient), [queryClient])

  // QueryClient 在最外层：主题与语言都来自设置（TanStack Query 缓存）
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <I18nProvider>
          <TooltipProvider delay={400}>
            {children}
            <ThemedToaster />
          </TooltipProvider>
        </I18nProvider>
      </ThemeProvider>
    </QueryClientProvider>
  )
}

function ThemedToaster(): JSX.Element {
  return <Toaster theme={useResolvedTheme()} position="bottom-right" />
}

/** 直接用浏览器打开开发服务器时的提示（此时没有主进程，也就没有 i18n 设置） */
function NotInElectron(): JSX.Element {
  return (
    <main className="flex h-full flex-col justify-center gap-2 px-12 text-sm text-muted-foreground">
      <p className="text-base font-medium text-foreground">PremiumCowHorse</p>
      <p lang="ja">このページは Electron から起動してください（pnpm dev）。</p>
      <p lang="zh-CN">请通过 Electron 启动此页面（pnpm dev）。</p>
      <p lang="en">Open this page from Electron (pnpm dev).</p>
    </main>
  )
}
