import { app } from 'electron'
import type { Container } from './container'

/**
 * 退出编排：before-quit 时先阻止退出，按顺序异步释放资源后再真正退出。
 * M3 起在这里先保存会话快照；M4 起再关闭远程连接池与文件监听。
 */
export function registerShutdown(c: Container, disposeIpc: () => void): void {
  let state: 'running' | 'stopping' | 'done' = 'running'
  app.on('before-quit', (event) => {
    if (state === 'done') return
    event.preventDefault()
    if (state === 'stopping') return
    state = 'stopping'
    disposeIpc()
    c.db
      .destroy()
      .then(() => c.logger.info('[app] shutdown complete'))
      .catch((e: unknown) => c.logger.error('[app] shutdown failed', e))
      .finally(() => {
        state = 'done'
        app.quit()
      })
  })
}
