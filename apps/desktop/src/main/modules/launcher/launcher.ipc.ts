import type { HandlersOf } from '../../ipc/router'
import type { LauncherService } from './launcher.service'

type LauncherChannel = 'launcher.capabilities' | 'launcher.open' | 'launcher.redetect'

/** Office 等文件的打开方式检测与启动的 IPC（参数已由路由按契约校验） */
export function launcherHandlers(
  launcher: Pick<LauncherService, 'capabilities' | 'open' | 'redetect'>
): HandlersOf<LauncherChannel> {
  return {
    'launcher.capabilities': async ({ uri }) => launcher.capabilities(uri),
    'launcher.open': async ({ uri, mode }) => launcher.open(uri, mode),
    'launcher.redetect': async () => launcher.redetect()
  }
}
