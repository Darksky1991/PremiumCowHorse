import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import {
  IPC_INVOKE,
  ipcContract,
  isIpcChannel,
  toErrorPayload,
  type ErrorCode,
  type IpcChannel,
  type IpcInput,
  type IpcOutput,
  type IpcResult
} from '@pch/shared'
import type { Logger } from '../infra/logger'

export interface IpcContext {
  senderId: number
}

export type Handler<C extends IpcChannel> = (
  input: IpcInput<C>,
  ctx: IpcContext
) => Promise<IpcOutput<C>>
export type HandlersOf<C extends IpcChannel> = { [K in C]: Handler<K> }
/** 契约中的每个通道都必须实现，漏写会编译失败 */
export type Handlers = HandlersOf<IpcChannel>

const fail = (code: ErrorCode, detail?: string): IpcResult<never> => ({
  ok: false,
  error: { code, detail }
})

/**
 * 契约驱动的 IPC 路由：所有调用经由唯一的 IPC_INVOKE 通道进入，依次
 * 校验发送方来源 → 校验通道名（白名单即契约）→ zod 校验输入 → 调用 handler → 统一包装结果。
 * @param trustedUrlPrefix 渲染端地址前缀（app://renderer/ 或开发服务器地址）
 */
export function registerIpc(
  handlers: Handlers,
  logger: Logger,
  trustedUrlPrefix: string
): () => void {
  ipcMain.handle(IPC_INVOKE, async (event: IpcMainInvokeEvent, envelope: unknown) => {
    const url = event.senderFrame?.url ?? ''
    if (!url.startsWith(trustedUrlPrefix)) {
      logger.warn(`[ipc] rejected call from ${url}`)
      return fail('IPC_FORBIDDEN')
    }
    const { channel, input } = (envelope ?? {}) as { channel?: unknown; input?: unknown }
    if (typeof channel !== 'string' || !isIpcChannel(channel)) {
      return fail('IPC_UNKNOWN_CHANNEL', String(channel))
    }
    const parsed = ipcContract[channel].input.safeParse(input)
    if (!parsed.success) return fail('IPC_BAD_INPUT', parsed.error.message)
    try {
      const handler = handlers[channel] as Handler<IpcChannel>
      const data = await handler(parsed.data as never, { senderId: event.sender.id })
      return { ok: true, data } satisfies IpcResult<unknown>
    } catch (e) {
      logger.error(`[ipc] ${channel}`, e)
      return { ok: false, error: toErrorPayload(e) } satisfies IpcResult<unknown>
    }
  })
  return () => ipcMain.removeHandler(IPC_INVOKE)
}
