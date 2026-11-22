import type { HandlersOf } from '../../ipc/router'
import type { RemoteScope } from '../../vfs/remote-access'
import type { LauncherService } from './launcher.service'

type LauncherChannel = 'launcher.capabilities' | 'launcher.open' | 'launcher.redetect'

/**
 * Office 等文件的打开方式检测与启动的 IPC（参数已由路由按契约校验）。
 * sftp: URI 必须在远程条目之下（设计 5.7）
 */
export function launcherHandlers(
  launcher: Pick<LauncherService, 'capabilities' | 'open' | 'redetect'>,
  scope: Pick<RemoteScope, 'check'>
): HandlersOf<LauncherChannel> {
  return {
    'launcher.capabilities': async ({ uri }) => {
      await scope.check(uri)
      return launcher.capabilities(uri)
    },
    'launcher.open': async ({ uri, mode }) => {
      await scope.check(uri)
      return launcher.open(uri, mode)
    },
    'launcher.redetect': async () => launcher.redetect()
  }
}
