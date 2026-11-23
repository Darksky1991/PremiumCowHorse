import type { HandlersOf } from '../../ipc/router'
import type { RecentService } from './recent.service'

/** 参数已由路由按契约校验，这里只转发给 service */
export function recentHandlers(
  recent: RecentService
): HandlersOf<'recent.list' | 'recent.record' | 'recent.clear'> {
  return {
    'recent.list': ({ workspaceId, limit }) => recent.list(workspaceId, limit),
    'recent.record': (input) => recent.record(input),
    'recent.clear': ({ workspaceId }) =>
      recent.clear(workspaceId === undefined ? {} : { workspaceId })
  }
}
