import { z } from 'zod'
import type { AppErrorPayload } from '../errors/app-error'
import { SettingsPatch, type Settings } from '../settings/schema'
import {
  EntryAddInput,
  EntryMoveInput,
  EntryUpdateInput,
  WorkspaceCreateInput,
  WorkspaceUpdateInput
} from '../workspace/schema'
import type { FileEntry, FileStat } from '../vfs/types'
import type { Workspace, WorkspaceEntry } from '../workspace/types'

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

/** 发起调用的那个窗口的状态（自绘窗口按钮据此切换「最大化 / 还原」图标） */
export interface WindowState {
  maximized: boolean
}

/**
 * 渲染端 → 主进程的全部通道。主进程注册时必须全部实现（漏写会编译失败），
 * 渲染端调用时自动获得输入输出类型。
 */
export const ipcContract = {
  'app.getInfo': route<AppInfo>()(z.void()),
  'settings.getAll': route<Settings>()(z.void()),
  'settings.set': route<void>()(SettingsPatch),
  /** 工作区；「当前工作区」= 最近一次 activate 的工作区 */
  'workspace.list': route<Workspace[]>()(z.void()),
  'workspace.active': route<Workspace>()(z.void()),
  'workspace.create': route<Workspace>()(WorkspaceCreateInput),
  'workspace.update': route<Workspace>()(WorkspaceUpdateInput),
  'workspace.delete': route<void>()(z.strictObject({ id: z.string().min(1) })),
  'workspace.activate': route<void>()(z.strictObject({ id: z.string().min(1) })),
  /** 工作区条目（group / folder / file） */
  'entry.list': route<WorkspaceEntry[]>()(z.strictObject({ workspaceId: z.string().min(1) })),
  'entry.add': route<WorkspaceEntry>()(EntryAddInput),
  'entry.update': route<WorkspaceEntry>()(EntryUpdateInput),
  'entry.remove': route<void>()(z.strictObject({ id: z.string().min(1) })),
  'entry.move': route<void>()(EntryMoveInput),
  /** 文件系统（经 VfsService 按 scheme 路由）；requestId 用于取消，同一 id 的新请求取代旧请求 */
  'vfs.stat': route<FileStat>()(z.strictObject({ uri: z.string().min(1) })),
  'vfs.list': route<FileEntry[]>()(
    z.strictObject({ uri: z.string().min(1), requestId: z.string().min(1) })
  ),
  'vfs.cancel': route<void>()(z.strictObject({ requestId: z.string().min(1) })),
  /** 渲染端当前需要监听的目录集合（整体替换）；变化经 vfs.changed 事件广播 */
  'vfs.watch': route<void>()(z.strictObject({ uris: z.array(z.string().min(1)).max(500) })),
  /** 自绘标题栏的窗口按钮：作用于发起调用的窗口 */
  'window.minimize': route<void>()(z.void()),
  'window.toggleMaximize': route<void>()(z.void()),
  'window.close': route<void>()(z.void()),
  'window.getState': route<WindowState>()(z.void()),
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
  /** 工作区或其条目发生变化（id 为工作区 id） */
  'workspace.changed': { id: string }
  /** 被监听的目录内容发生变化（已防抖） */
  'vfs.changed': { uri: string }
  /** 只发给状态发生变化的那个窗口 */
  'window.stateChanged': WindowState
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
