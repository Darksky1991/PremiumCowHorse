import type { HandlersOf } from '../../ipc/router'
import type { WorkspaceService } from './workspace.service'

/** 参数已由路由按契约校验，这里只转发给 service */
export function workspaceHandlers(
  workspaces: WorkspaceService
): HandlersOf<
  | 'workspace.list'
  | 'workspace.active'
  | 'workspace.create'
  | 'workspace.update'
  | 'workspace.delete'
  | 'workspace.activate'
  | 'workspace.summaries'
  | 'workspace.reorder'
  | 'entry.list'
  | 'entry.add'
  | 'entry.update'
  | 'entry.remove'
  | 'entry.move'
  | 'entry.setCacheStrategy'
  | 'index.setTarget'
  | 'index.list'
> {
  return {
    'workspace.list': () => workspaces.list(),
    'workspace.active': () => workspaces.active(),
    'workspace.create': (input) => workspaces.create(input),
    'workspace.update': (input) => workspaces.update(input),
    'workspace.delete': ({ id }) => workspaces.delete(id),
    'workspace.activate': ({ id }) => workspaces.activate(id),
    'workspace.summaries': () => workspaces.summaries(),
    'workspace.reorder': ({ ids }) => workspaces.reorder(ids),
    'entry.list': ({ workspaceId }) => workspaces.listEntries(workspaceId),
    'entry.add': (input) => workspaces.addEntry(input),
    'entry.update': (input) => workspaces.updateEntry(input),
    'entry.remove': ({ id }) => workspaces.removeEntry(id),
    'entry.move': (input) => workspaces.moveEntry(input),
    'entry.setCacheStrategy': (input) => workspaces.setCacheStrategy(input),
    'index.setTarget': (input) => workspaces.setIndexTarget(input),
    'index.list': ({ workspaceId }) => workspaces.listIndexTargets(workspaceId)
  }
}
