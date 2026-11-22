import { app } from 'electron'
import type { Container } from './container'

/**
 * 退出编排：before-quit 时先阻止退出，按顺序异步释放资源后再真正退出。
 * 桌面记录的退出时保存在关闭主窗口时完成（ExitGuard），这里只停止并等待写入；远程连接池关闭并等待锁定写入。
 */
export function registerShutdown(c: Container, disposeIpc: () => void): void {
  let state: 'running' | 'stopping' | 'done' = 'running'
  app.on('before-quit', (event) => {
    // 退出流程已开始：之后 app.quit 关闭窗口时不再拦截主窗口的 close（不会再询问 / 死循环）
    c.exitGuard.quitStarted()
    if (state === 'done') return
    event.preventDefault()
    if (state === 'stopping') return
    state = 'stopping'
    disposeIpc()
    c.documents.dispose()
    c.web.dispose()
    // 桌面记录：停止监控与自动保存，等进行中的写入结束后再关闭数据库
    c.desktop.stop()
    // 远程连接池：关闭连接；中止进行中的连接 / 身份打开时的锁定写入（auth_state）完成后才关闭数据库
    Promise.all([c.vfs.dispose(), c.scanner.dispose(), c.desktop.idle(), c.pool.dispose()])
      .then(() => c.db.destroy())
      .then(() => c.logger.info('[app] shutdown complete'))
      .catch((e: unknown) => c.logger.error('[app] shutdown failed', e))
      .finally(() => {
        state = 'done'
        app.quit()
      })
  })
}
