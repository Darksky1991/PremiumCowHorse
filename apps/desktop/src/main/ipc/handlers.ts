import type { Container } from '../bootstrap/container'
import { settingsHandlers } from '../modules/settings/settings.ipc'
import { systemHandlers } from '../modules/system/system.ipc'
import { windowHandlers } from '../modules/window/window.ipc'
import { workspaceHandlers } from '../modules/workspace/workspace.ipc'
import type { Handlers } from './router'

/** 汇总各模块的 handler */
export function createHandlers(c: Container): Handlers {
  return {
    ...systemHandlers(c.logger),
    ...settingsHandlers(c.settings),
    ...windowHandlers(),
    ...workspaceHandlers(c.workspaces)
  }
}
