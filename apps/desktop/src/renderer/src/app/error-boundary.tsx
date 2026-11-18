import { Component, type ErrorInfo, type ReactNode } from 'react'
import { resources } from '@pch/i18n'
import { Button } from '@pch/ui/components/button'
import { getBootstrap } from '@renderer/lib/ipc'
import { reportError } from '@renderer/lib/report-error'

interface State {
  error: Error | null
}

/**
 * 最外层的错误边界：渲染异常时显示可恢复的提示，而不是白屏，并把错误写入 main.log。
 * 位于所有 Provider 之外（Provider 本身也可能出错），因此直接读取语言资源，不依赖 i18n 上下文。
 */
export class RootErrorBoundary extends Component<{ children: ReactNode }, State> {
  override state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    reportError(error, `render${info.componentStack ? `\n${info.componentStack}` : ''}`)
  }

  override render(): ReactNode {
    if (!this.state.error) return this.props.children
    const t = resources[getBootstrap()?.language ?? 'en'].common
    return (
      <main role="alert" className="flex h-full flex-col justify-center gap-3 px-14">
        <h1 className="text-xl font-semibold">{t.crashTitle}</h1>
        <p className="max-w-prose text-sm text-muted-foreground">{t.crashHint}</p>
        <pre className="max-w-prose truncate font-mono text-xs text-muted-foreground">
          {this.state.error.message}
        </pre>
        <div>
          <Button onClick={() => window.location.reload()}>{t.reload}</Button>
        </div>
      </main>
    )
  }
}
