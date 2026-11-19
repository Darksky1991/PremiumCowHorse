import { z } from 'zod'
import type { AppErrorPayload } from '../errors/app-error'
import { SettingsPatch, type Settings } from '../settings/schema'
import {
  EntryAddInput,
  EntryMoveInput,
  EntrySetCacheStrategyInput,
  IndexSetTargetInput,
  EntryUpdateInput,
  WorkspaceCreateInput,
  WorkspaceUpdateInput
} from '../workspace/schema'
import type { DirectoryListing, FileStat } from '../vfs/types'
import type { SearchResult } from '../search/types'
import type { OfflineShare, ReachabilityEvent } from '../scanner/types'
import type { Workspace, WorkspaceEntry } from '../workspace/types'

/** vfs.interest 的 visible / offscreen 与 vfs.refresh 的 uris 的上限（渲染端超过时截断） */
export const VFS_INTEREST_VISIBLE_MAX = 2000
export const VFS_INTEREST_OFFSCREEN_MAX = 5000
export const VFS_REFRESH_MAX = 500

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
  'entry.setCacheStrategy': route<WorkspaceEntry>()(EntrySetCacheStrategyInput),
  'index.setTarget': route<void>()(IndexSetTargetInput),
  'index.list': route<string[]>()(z.strictObject({ workspaceId: z.string().min(1) })),
  /** 文件系统的一次性调用（经 VfsService 按 scheme 路由）；requestId 用于取消，同一 id 的新请求取代旧请求 */
  'vfs.stat': route<FileStat>()(z.strictObject({ uri: z.string().min(1) })),
  /**
   * 目录列表：经扫描进程（有缓存立即返回缓存并安排检查，没有则枚举后返回）；扫描进程不可用时
   * 由 VfsService 直接枚举（state 'fresh'）。requestId 只对直接枚举有效（vfs.cancel）
   */
  'vfs.list': route<DirectoryListing>()(
    z.strictObject({ uri: z.string().min(1), requestId: z.string().min(1).optional() })
  ),
  'vfs.cancel': route<void>()(z.strictObject({ requestId: z.string().min(1) })),
  /** 本窗口的关注点与已展开目录（视口内 / 外，整体替换）；缓存内容变化经 vfs.changed 广播 */
  'vfs.interest': route<void>()(
    z.strictObject({
      focus: z.string().min(1).nullable(),
      visible: z.array(z.string().min(1)).max(VFS_INTEREST_VISIBLE_MAX),
      offscreen: z.array(z.string().min(1)).max(VFS_INTEREST_OFFSCREEN_MAX)
    })
  ),
  /** F5 / 刷新按钮 / 「重试」：立即检查这些目录（断开的共享也立即尝试一次） */
  'vfs.refresh': route<void>()(
    z.strictObject({ uris: z.array(z.string().min(1)).max(VFS_REFRESH_MAX) })
  ),
  /** 目录缓存（userData/cache/index.db）的占用与清空；界面随 M5 设置页 */
  /**
   * 当前断开的共享 / 卷（主进程随 vfs.reachability 维护）。渲染端订阅 vfs.reachability 时先查询一次，
   * 窗口启动、重新加载后不漏掉此前已断开的共享
   */
  'vfs.offlineShares': route<OfflineShare[]>()(z.strictObject({})),
  'vfs.cacheInfo': route<{ bytes: number }>()(z.strictObject({})),
  'vfs.clearCache': route<void>()(z.strictObject({})),
  /**
   * 文件名搜索：只查缓存（不访问文件系统）。text 按空白分词（AND），含 * / ? 的词为通配；
   * 范围为该工作区的 folder 条目（固定的单个文件条目按名称匹配）。同一 requestId 的新查询取代旧查询，
   * 渲染端取消用 vfs.cancel。扫描进程不可用时以 INDEX_UNAVAILABLE 拒绝
   */
  'search.query': route<SearchResult>()(
    z.strictObject({
      workspaceId: z.string().min(1),
      text: z.string().max(500),
      kind: z.enum(['all', 'file', 'directory']),
      limit: z.number().int().min(1).max(1000).optional(),
      requestId: z.string().min(1)
    })
  ),
  /** 系统操作（均不修改文件）：在资源管理器中显示 / 用系统应用打开 / 写剪贴板 / 选择路径对话框 */
  'system.revealInOs': route<void>()(z.strictObject({ uri: z.string().min(1) })),
  /**
   * 用系统关联的应用打开（shell.openPath）。只由预览插件的宿主经用户点击调用，
   * 可执行类扩展名由渲染端先确认（设计 devDoc/2026-11-19-12 第 3.3 节）
   */
  'system.openPath': route<void>()(z.strictObject({ uri: z.string().min(1) })),
  'system.copyText': route<void>()(z.strictObject({ text: z.string().max(32768) })),
  /** 返回所选本地路径；用户取消时为空数组 */
  'system.selectPaths': route<string[]>()(
    z.strictObject({ kind: z.enum(['folder', 'file']), multiple: z.boolean() })
  ),
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
  /** 目录的缓存内容（列表或状态）有变化 */
  'vfs.changed': { uri: string }
  /** 共享（`\\host\share`，小写）或卷（`C:`）断开 / 恢复 */
  'vfs.reachability': ReachabilityEvent
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
