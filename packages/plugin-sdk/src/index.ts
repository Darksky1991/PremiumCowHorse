import type { ComponentType } from 'react'
import type { PreviewDocApi } from './doc'

export * from './doc'

/**
 * 预览插件 SDK（架构文档第 9 节）。
 * 插件只能通过 PreviewHost 与外界交互，拿不到 window.pch；插件包只能依赖本 SDK 与 @pch/ui。
 * M1-3 实现 MVP 契约：注册表、PreviewContainer 与宿主在渲染端 features/preview。
 *
 * 文件系统的类型与 @pch/shared 的同名类型结构相同（SDK 不依赖 shared，模块边界规则不允许）；
 * 渲染端的宿主实现把 shared 的值直接赋给这里的类型，结构不一致时编译失败。
 */

export type FileKind = 'file' | 'directory' | 'symlink'

export interface FileStat {
  uri: string
  name: string
  kind: FileKind
  /** 字节数；目录为 0 */
  size: number
  /** 修改时间（UNIX 毫秒） */
  mtime: number
}

export interface FileEntry extends FileStat {
  hidden: boolean
  /** 仅 kind 为 symlink 时存在：链接目标的类型；null 表示目标不存在或无法解析（失效链接） */
  target?: 'file' | 'directory' | null
}

/**
 * 目录列表（缓存优先）：fresh 为刚确认过，cached 为缓存内容（检查已安排），
 * offline 为所在共享断开（内容为缓存）；checkedAt 为上次检查的时刻（没有记录时为 null）
 */
export interface DirectoryListing {
  items: FileEntry[]
  state: 'fresh' | 'cached' | 'offline'
  checkedAt: number | null
}

export interface ResourceInfo {
  uri: string
  name: string
  kind: 'file' | 'directory'
  size: number
  mtime: number
  /** M1-3 不推断，为 null */
  mime: string | null
  /**
   * 没有插件按扩展名 / MIME 匹配、宿主读开头 8KB 判为文本时为 true（此时交给声明了 match.textLike 的插件）；
   * 未判断时不存在
   */
  textLike?: boolean
}

export interface PreviewPluginManifest {
  /** 例如 'pch.preview.image' */
  id: string
  /** 插件自带语言资源中的键（见 PreviewPlugin.i18n） */
  name: string
  version: string
  /** 多个插件都能处理时的优先级（加到匹配得分上） */
  priority?: number
  /**
   * 匹配条件（doc 9.3）：kinds / schemes / maxSize 不满足则排除；声明了 extensions 或 mimeTypes 时
   * 至少命中一项（扩展名 3 分、MIME 精确 2 分、MIME 通配 1 分），都没声明时只按 kinds 等条件匹配（0 分）
   */
  match: {
    kinds?: Array<'file' | 'directory'>
    /** 不带点、大小写不敏感，例如 ['png', 'tar.gz'] */
    extensions?: string[]
    /** 'image/png' 或通配 'image/*' */
    mimeTypes?: string[]
    /** 不带冒号，例如 ['file']；不填表示所有资源类型 */
    schemes?: string[]
    /** 超过则不参与匹配（字节） */
    maxSize?: number
    /**
     * 也接受「没有任何插件按扩展名 / MIME 匹配、开头判为文本」的文件（ResourceInfo.textLike 为 true）。
     * 只在未匹配时参与：扩展名 / MIME 命中的插件优先。只声明 textLike（没有 extensions / mimeTypes）时只接受判为文本的文件
     */
    textLike?: boolean
  }
  /** 声明式不够用时的补充判断：返回 false 则排除 */
  when?: (resource: ResourceInfo) => boolean
  /**
   * 插件自己处理「文件已不存在」（文本插件：保留已显示的内容并提示）：显示中的文件被删除、
   * 重新 stat 得到 FS_NOT_FOUND 时，容器继续显示本插件（资源描述为删除之前的），而不是「找不到」。
   * 同名文件重新出现时照常更新。不声明时容器显示「找不到」与「重试」
   */
  handlesMissing?: boolean
}

export type ToastType = 'info' | 'success' | 'warning' | 'error'

/** PreviewHost.tabs.viewAs 的查看方式 */
export type ViewAsMode = 'text' | 'info'

/** 插件可读取的应用设置（只读，键与应用设置相同） */
export interface HostSettings {
  'explorer.showHiddenFiles': boolean
}

export interface PreviewHost {
  fs: {
    stat(uri: string): Promise<FileStat>
    /**
     * 目录列表（与资源树共用缓存）；失败时以带 code 的错误拒绝（目录不在了为 FS_NOT_FOUND）。
     * 所在共享断开时 state 为 offline（内容为缓存）
     */
    list(uri: string): Promise<DirectoryListing>
    /**
     * 让宿主立即重新确认该目录（刷新请求见 tabs.onRefresh）：之后的 list 取得确认后的内容
     */
    refresh(uri: string): Promise<void>
    /** 该目录的缓存内容有变化时回调（之后再 list 取得新内容）；返回取消订阅函数 */
    subscribe(uri: string, onChange: () => void): () => void
    /** 显示用的路径（file URI → Windows 路径；无法转换时原样返回 URI） */
    toDisplayPath(uri: string): string
    /**
     * uri 所属的工作区条目（folder）的根 URI：包含它的条目中最内层者；不在任何条目之下时为 null
     */
    rootOf(uri: string): string | null
  }
  /**
   * 浏览器式（M1-3b 设计 2.8，没有「预览标签」）：navigate / up 在当前标签内打开并进入该标签的历史，
   * open 在新标签打开
   */
  tabs: {
    /** 在新标签中打开（同 URI 已打开则激活）：中键 / Ctrl+单击等 */
    open(uri: string): void
    /**
     * 在当前标签内导航到另一资源（目录或文件；替换当前标签的位置，离开的位置进入后退历史）。
     * kind 为插件已知的类型（例如目录列表中的项）：给出时宿主不再 stat，标题取 URI 的最后一段
     */
    navigate(uri: string, kind?: 'file' | 'directory'): void
    /**
     * 当前标签按逻辑路径到上一级（宿主计算）：条目内逐级向上，条目根的上一级是工作区总览，
     * 不越过条目根走到磁盘上的上级；已在总览时不做任何事
     */
    up(): void
    /**
     * 用户请求刷新本标签（应用地址栏的刷新按钮、F5）时回调；返回取消订阅函数。
     * 刷新入口在应用的地址栏（M1-3b），插件不自带刷新按钮与 F5 处理（避免重复触发）
     */
    onRefresh(listener: () => void): () => void
    /**
     * 本标签改用另一种方式查看当前资源（按标签的临时状态，导航到其他位置后恢复自动选择）：
     * text = 文本插件（pch.preview.text），info = 文件信息（fallback 插件）
     */
    viewAs(mode: ViewAsMode): void
    /** 该查看方式是否可用（对应的插件已注册、资源是文件）；不可用时 viewAs 不做任何事 */
    canViewAs(mode: ViewAsMode): boolean
  }
  /** 文本文档（分页读取）；自动刷新由宿主负责 */
  doc: PreviewDocApi
  /** 系统操作：失败时由宿主提示错误，Promise 不会拒绝 */
  system: {
    revealInOs(uri: string): void
    /** 复制路径到剪贴板并提示 */
    copyPath(uri: string): Promise<void>
    /** 用系统关联的应用打开；可执行类扩展名由宿主先弹确认框，取消时不打开 */
    openWithSystem(uri: string): Promise<void>
  }
  ui: {
    toast(message: string, type?: ToastType): void
  }
  /**
   * t 查找插件自带的语言资源（PreviewPlugin.i18n）；language 为当前界面语言；
   * describeError 把宿主 API 拒绝时的错误（带 code），或错误码本身（DocProgress.error）转为应用的错误文案
   */
  i18n: {
    t(key: string, vars?: Record<string, unknown>): string
    language: string
    describeError(error: unknown): string
  }
  theme: { mode: 'light' | 'dark' }
  settings: { get<K extends keyof HostSettings>(key: K): HostSettings[K] | undefined }
}

export interface PreviewProps<VS = unknown> {
  resource: ResourceInfo
  host: PreviewHost
  /** 会话恢复时传回（M1-3 只在内存中） */
  viewState: VS | undefined
  /**
   * 保存视图状态（属于本视图显示的位置）。卸载时（包括标签已导航离开之后）也可以调用：
   * 宿主写入该位置刚离开时的历史项，不会落到新位置上
   */
  onViewStateChange: (state: VS) => void
}

export interface PreviewPlugin<VS = unknown> {
  manifest: PreviewPluginManifest
  /**
   * 插件自带的语言资源：{ ja: {...}, 'zh-CN': {...}, en: {...} }。
   * 键不含 '.'（i18next 的键分隔符）；缺少当前语言时退回 en
   */
  i18n?: Record<string, Record<string, string>>
  /** 懒加载，首屏不打包 */
  load: () => Promise<{ default: ComponentType<PreviewProps<VS>> }>
}

/** 注册表中的插件列表元素：各插件的 viewState 类型不同，PreviewPlugin<unknown> 容纳不了 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- 见上
export type AnyPreviewPlugin = PreviewPlugin<any>

/** 无任何插件匹配时使用的插件 id（doc 9.3） */
export const FALLBACK_PLUGIN_ID = 'pch.preview.fallback'

/** 文本插件的 id（「作为文本查看」使用） */
export const TEXT_PLUGIN_ID = 'pch.preview.text'

export const definePreviewPlugin = <VS>(plugin: PreviewPlugin<VS>): PreviewPlugin<VS> => plugin
