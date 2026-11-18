import type { ComponentType } from 'react'

/**
 * 预览插件 SDK（架构文档第 9 节）。
 * 插件只能通过 PreviewHost 与外界交互，拿不到 window.pch。
 * M0 阶段只定义契约，注册表与 PreviewContainer 在 M2 实现。
 */

export interface ResourceInfo {
  uri: string
  name: string
  kind: 'file' | 'directory'
  size: number
  mtime: number
  mime: string | null
}

export interface PreviewPluginManifest {
  /** 例如 'pch.preview.image' */
  id: string
  /** i18n key */
  name: string
  version: string
  /** 多个插件都能处理时的优先级 */
  priority?: number
  match: {
    kinds?: Array<'file' | 'directory'>
    extensions?: string[]
    mimeTypes?: string[]
    /** 不填表示所有资源类型 */
    schemes?: string[]
    /** 超过则不参与匹配 */
    maxSize?: number
  }
  /** 声明式不够用时的补充判断 */
  when?: (resource: ResourceInfo) => boolean
}

export type ToastType = 'info' | 'success' | 'warning' | 'error'

export interface StatusItem {
  id: string
  text: string
  tooltip?: string
}

export interface PreviewHost {
  fs: {
    toResourceUrl(uri: string): string
  }
  tabs: {
    open(uri: string, opts?: { pluginId?: string; background?: boolean; newWindow?: boolean }): void
  }
  ui: {
    setTitle(title: string): void
    setStatus(items: StatusItem[]): void
    toast(message: string, type?: ToastType): void
  }
  i18n: { t(key: string, vars?: Record<string, unknown>): string; language: string }
  theme: { mode: 'light' | 'dark' }
  /** 仅限插件自己的命名空间 */
  settings: { get<T>(key: string): T | undefined }
}

export interface PreviewProps<VS = unknown> {
  resource: ResourceInfo
  host: PreviewHost
  /** 会话恢复时传回 */
  viewState: VS | undefined
  onViewStateChange: (state: VS) => void
}

export interface PreviewPlugin<VS = unknown> {
  manifest: PreviewPluginManifest
  /** 插件自带的语言资源：{ ja: {...}, 'zh-CN': {...}, en: {...} } */
  i18n?: Record<string, Record<string, string>>
  /** 懒加载，首屏不打包 */
  load: () => Promise<{ default: ComponentType<PreviewProps<VS>> }>
}

export const definePreviewPlugin = <VS>(plugin: PreviewPlugin<VS>): PreviewPlugin<VS> => plugin
