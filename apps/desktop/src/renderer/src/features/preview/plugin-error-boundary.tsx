import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  /** 出错后显示的内容（错误面板） */
  fallback: (error: Error) => ReactNode
  onError: (error: Error, info: ErrorInfo) => void
}

interface State {
  error: Error | null
}

/**
 * 每个标签的插件外层的错误边界（doc 9.3）：插件渲染抛错或懒加载失败只影响该标签。
 * 换插件（「以文件信息显示」）或换资源时由调用方以 key 重建。
 */
export class PluginErrorBoundary extends Component<Props, State> {
  override state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    this.props.onError(error, info)
  }

  override render(): ReactNode {
    return this.state.error ? this.props.fallback(this.state.error) : this.props.children
  }
}
