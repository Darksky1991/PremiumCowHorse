import type { ComponentType } from 'react'

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
  }
  /** 声明式不够用时的补充判断：返回 false 则排除 */
  when?: (resource: ResourceInfo) => boolean
}

export type ToastType = 'info' | 'success' | 'warning' | 'error'

/** 插件可读取的应用设置（只读，键与应用设置相同） */
export interface HostSettings {
  'explorer.showHiddenFiles': boolean
}

export interface PreviewHost {
  fs: {
    stat(uri: string): Promise<FileStat>
    /** 目录列表（与资源树共用缓存）；失败时以带 code 的错误拒绝 */
    list(uri: string): Promise<DirectoryListing>
    /** 该目录的缓存内容有变化时回调（之后再 list 取得新内容）；返回取消订阅函数 */
    subscribe(uri: string, onChange: () => void): () => void
    /** 显示用的路径（file URI → Windows 路径；无法转换时原样返回 URI） */
    toDisplayPath(uri: string): string
  }
  /** 以下动作都视为「在标签内交互」：所在的预览标签转为常驻 */
  tabs: {
    /** 在新标签中打开（已打开则激活）；preview 为 true 时以预览标签打开 */
    open(uri: string, opts?: { preview?: boolean }): void
    /** 在当前标签内导航到另一资源（替换当前标签的 URI 与标题） */
    navigate(uri: string): void
  }
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
  /** t 查找插件自带的语言资源（PreviewPlugin.i18n）；language 为当前界面语言 */
  i18n: { t(key: string, vars?: Record<string, unknown>): string; language: string }
  theme: { mode: 'light' | 'dark' }
  settings: { get<K extends keyof HostSettings>(key: K): HostSettings[K] | undefined }
}

export interface PreviewProps<VS = unknown> {
  resource: ResourceInfo
  host: PreviewHost
  /** 会话恢复时传回（M1-3 只在内存中） */
  viewState: VS | undefined
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

export const definePreviewPlugin = <VS>(plugin: PreviewPlugin<VS>): PreviewPlugin<VS> => plugin
