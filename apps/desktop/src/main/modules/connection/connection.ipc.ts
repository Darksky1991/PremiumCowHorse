import type { HandlersOf } from '../../ipc/router'
import type { ConnectionService } from './connection.service'
import type { HostKeyGate } from './host-key-gate'

type ConnectionChannel =
  | 'connection.list'
  | 'connection.save'
  | 'connection.delete'
  | 'connection.test'
  | 'connection.reconnect'
  | 'connection.trustHostKey'
  | 'connection.answerHostKey'
  | 'connection.pendingHostKeyPrompts'
  | 'connection.home'

/**
 * 远程连接的 IPC（参数已由路由按契约校验）。按 connectionId 操作，不受条目范围限制（设计 5.7）。
 * 机密（save 的 secret / sudoSecret）不进日志：路由的错误日志不含输入
 */
export function connectionHandlers(
  service: Pick<
    ConnectionService,
    'list' | 'save' | 'delete' | 'test' | 'reconnect' | 'trustHostKey' | 'home'
  >,
  hostKeys: Pick<HostKeyGate, 'answer' | 'pending'>
): HandlersOf<ConnectionChannel> {
  return {
    'connection.list': () => service.list(),
    'connection.save': (input) => service.save(input),
    'connection.delete': ({ id }) => service.delete(id),
    'connection.test': ({ id }) => service.test(id),
    'connection.reconnect': ({ id }) => service.reconnect(id),
    'connection.trustHostKey': ({ id }) => service.trustHostKey(id),
    'connection.answerHostKey': async ({ promptId, accept }) => hostKeys.answer(promptId, accept),
    'connection.pendingHostKeyPrompts': async () => hostKeys.pending(),
    'connection.home': ({ id, identity }) => service.home(id, identity)
  }
}
