import type { HandlersOf } from '../../ipc/router'
import type { DesktopService } from './desktop.service'
import type { ExitGuard } from './exit-guard'

type DesktopChannel =
  | 'desktop.list'
  | 'desktop.get'
  | 'desktop.current'
  | 'desktop.save'
  | 'desktop.rename'
  | 'desktop.delete'
  | 'desktop.restore'
  | 'desktop.clear'
  | 'desktop.restorePrompt'
  | 'desktop.exit'
  | 'desktop.cancelExit'
  | 'desktop.exitShown'

/** 桌面记录的 IPC（参数已由路由按契约校验） */
export function desktopHandlers(
  desktop: Pick<
    DesktopService,
    | 'list'
    | 'get'
    | 'current'
    | 'saveManual'
    | 'rename'
    | 'delete'
    | 'restore'
    | 'clear'
    | 'restorePrompt'
  >,
  exit: Pick<ExitGuard, 'exit' | 'cancel' | 'shown'>
): HandlersOf<DesktopChannel> {
  return {
    'desktop.list': async () => desktop.list(),
    'desktop.get': async ({ id }) => desktop.get(id),
    'desktop.current': async () => desktop.current(),
    'desktop.save': async ({ picks, name }) => desktop.saveManual(picks, name),
    'desktop.rename': async ({ id, name }) => desktop.rename(id, name),
    'desktop.delete': async ({ id }) => desktop.delete(id),
    'desktop.restore': async ({ snapshotId, picks }) => desktop.restore(snapshotId, picks),
    'desktop.clear': async () => desktop.clear(),
    'desktop.restorePrompt': async () => desktop.restorePrompt(),
    'desktop.exit': async (input) => exit.exit(input),
    'desktop.cancelExit': async () => exit.cancel(),
    'desktop.exitShown': async () => exit.shown()
  }
}
