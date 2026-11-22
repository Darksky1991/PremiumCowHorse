import type { Container } from '../bootstrap/container'
import { connectionHandlers } from '../modules/connection/connection.ipc'
import { desktopHandlers } from '../modules/desktop/desktop.ipc'
import { launcherHandlers } from '../modules/launcher/launcher.ipc'
import { settingsHandlers } from '../modules/settings/settings.ipc'
import { systemHandlers } from '../modules/system/system.ipc'
import { windowHandlers } from '../modules/window/window.ipc'
import { workspaceHandlers } from '../modules/workspace/workspace.ipc'
import { vfsHandlers } from '../vfs/vfs.ipc'
import { documentHandlers } from '../vfs/document/document.ipc'
import { webHandlers } from '../modules/web/web.ipc'
import { ownerWindowOf } from '../modules/web/web-session'
import { searchHandlers } from './search.ipc'
import type { Handlers } from './router'

/** 汇总各模块的 handler */
export function createHandlers(c: Container): Handlers {
  return {
    ...systemHandlers(c.logger, c.vfs),
    ...settingsHandlers(c.settings),
    ...windowHandlers(),
    ...workspaceHandlers(c.workspaces),
    ...vfsHandlers(c.vfs, c.scanner, c.remoteAccess),
    ...documentHandlers(c.documents, c.remoteAccess),
    ...searchHandlers(c.workspaces, c.settings, c.scanner),
    ...webHandlers(c.web, ownerWindowOf, c.remoteAccess),
    ...launcherHandlers(c.launcher, c.remoteAccess),
    ...desktopHandlers(c.desktop, c.exitGuard),
    ...connectionHandlers(c.connections, c.hostKeys)
  }
}
