import path from 'node:path'
import log from 'electron-log/main'
import type { AppPaths } from './paths'

export type Logger = Pick<typeof log, 'error' | 'warn' | 'info' | 'debug'>

export function createLogger(paths: AppPaths): Logger {
  log.transports.file.resolvePathFn = () => path.join(paths.logs, 'main.log')
  log.transports.file.maxSize = 5 * 1024 * 1024
  log.transports.file.level = 'info'
  log.transports.console.level = process.env.NODE_ENV === 'production' ? 'warn' : 'debug'
  log.errorHandler.startCatching()
  return log
}
