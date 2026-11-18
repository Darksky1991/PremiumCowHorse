import { z } from 'zod'
import type { AppErrorPayload } from '../errors/app-error'
import { SettingsPatch, type Settings } from '../settings/schema'

/** route<输出类型>()(输入 schema)：输入由 zod 运行时校验，输出只做类型约束 */
const route =
  <O>() =>
  <I extends z.ZodType>(input: I) => ({ input, output: undefined as unknown as O })

export interface AppInfo {
  name: string
  version: string
  electron: string
  chrome: string
  node: string
  platform: NodeJS.Platform
  arch: string
}

/**
 * 渲染端 → 主进程的全部通道。主进程注册时必须全部实现（漏写会编译失败），
 * 渲染端调用时自动获得输入输出类型。
 */
export const ipcContract = {
  'app.getInfo': route<AppInfo>()(z.void()),
  'settings.getAll': route<Settings>()(z.void()),
  'settings.set': route<void>()(SettingsPatch),
  /** 渲染端未捕获的错误写入主进程日志，便于用户反馈问题时提供 main.log */
  'log.write': route<void>()(
    z.object({
      level: z.enum(['error', 'warn', 'info']),
      message: z.string().max(10_000),
      stack: z.string().max(20_000).optional()
    })
  )
} as const

export function isIpcChannel(name: string): name is IpcChannel {
  return Object.hasOwn(ipcContract, name)
}

export type IpcContract = typeof ipcContract
export type IpcChannel = keyof IpcContract
export type IpcInput<C extends IpcChannel> = z.infer<IpcContract[C]['input']>
export type IpcOutput<C extends IpcChannel> = IpcContract[C]['output']

/** 主进程 → 渲染进程的广播事件 */
export interface IpcEvents {
  'settings.changed': Partial<Settings>
}
export type IpcEventName = keyof IpcEvents

/** Electron 跨进程抛出的 Error 会丢失错误码，因此统一包装成结果对象 */
export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: AppErrorPayload }

/** preload 通过 contextBridge 暴露给渲染端的 API（window.pch） */
export interface PchBridge {
  invoke(channel: string, input: unknown): Promise<unknown>
  on(event: string, listener: (payload: unknown) => void): () => void
  getPathForFile(file: File): string
  bootstrap: import('./bootstrap').BootstrapData | null
}
