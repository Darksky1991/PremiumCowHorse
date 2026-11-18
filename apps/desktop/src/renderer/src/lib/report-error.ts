import { getBridge } from './ipc'

/**
 * 把渲染端错误写入主进程日志（main.log）。用户反馈问题时只需提供这一个文件。
 * 本函数绝不抛出：错误上报失败时退回到控制台输出。
 */
export function reportError(error: unknown, context?: string): void {
  const err = error instanceof Error ? error : new Error(String(error))
  const message = context ? `${context}: ${err.message}` : err.message
  const bridge = getBridge()
  if (!bridge) {
    console.error(message, err)
    return
  }
  bridge
    .invoke('log.write', {
      level: 'error',
      message: message.slice(0, 10_000),
      stack: err.stack?.slice(0, 20_000)
    })
    .catch(() => console.error(message, err))
}

/** 捕获未被 React ErrorBoundary 覆盖的错误（事件回调、Promise 等） */
export function installGlobalErrorHandlers(): void {
  window.addEventListener('error', (e) => reportError(e.error ?? e.message, 'window.onerror'))
  window.addEventListener('unhandledrejection', (e) => reportError(e.reason, 'unhandledrejection'))
}
