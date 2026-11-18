import type { HandlersOf } from '../ipc/router'
import type { VfsService } from './vfs.service'

/** 参数已由路由按契约校验，这里只转发给 VfsService */
export function vfsHandlers(
  vfs: VfsService
): HandlersOf<'vfs.stat' | 'vfs.list' | 'vfs.cancel' | 'vfs.watch'> {
  return {
    'vfs.stat': ({ uri }) => vfs.stat(uri),
    'vfs.list': ({ uri, requestId }) => vfs.list(uri, requestId),
    'vfs.cancel': async ({ requestId }) => vfs.cancel(requestId),
    'vfs.watch': async ({ uris }, ctx) => vfs.setWatched(ctx.senderId, uris)
  }
}
