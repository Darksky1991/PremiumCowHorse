import { app } from 'electron'
import type { Logger } from '../../infra/logger'
import type { HandlersOf } from '../../ipc/router'

export function systemHandlers(logger: Logger): HandlersOf<'app.getInfo' | 'log.write'> {
  return {
    'app.getInfo': async () => ({
      name: app.getName(),
      version: app.getVersion(),
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
      platform: process.platform,
      arch: process.arch
    }),
    'log.write': async ({ level, message, stack }) => {
      logger[level](`[renderer] ${message}${stack ? `\n${stack}` : ''}`)
    }
  }
}
