import type { HostSettings, PreviewHost, ToastType } from '@pch/plugin-sdk'
import { AppError, isUnderUri, type DirectoryListing, type TabLocation } from '@pch/shared'
import type { Invoke } from '@renderer/data/vfs'
import { fileUriToWindowsPath } from '@renderer/lib/file-uri'
import type { TabTarget } from '@renderer/stores/tabs-store'
import { isExecutableExtension } from './executable'

/** 宿主依赖的外部能力：由 PreviewContainer 注入（单元测试注入假实现） */
export interface PreviewHostDeps {
  /** 插件所在的标签 */
  tabId: string
  /** 标签所属的工作区（tabs.open 在其中新开标签）；未加载时 tabs.open 不做任何事 */
  workspaceId: string | undefined
  invoke: Invoke
  /** 目录列表（与资源树共用 TanStack Query 的缓存） */
  listDirectory: (uri: string) => Promise<DirectoryListing>
  /** 让扫描进程立即确认该目录，并让其目录查询失效（之后的 listDirectory 重新取得） */
  refreshDirectory: (uri: string) => Promise<void>
  /** uri 所在的共享 / 卷在 reachability-store 中为断开 */
  isOffline: (uri: string) => boolean
  /** 订阅 vfs.changed，回调参数为变化的目录 URI；返回取消订阅函数 */
  onVfsChanged: (listener: (uri: string) => void) => () => void
  /** 订阅本标签的刷新请求（地址栏的刷新按钮 / F5）；返回取消订阅函数 */
  onRefresh: (listener: () => void) => () => void
  tabs: {
    open: (workspaceId: string, target: TabTarget) => void
    navigate: (id: string, target: TabTarget) => void
  }
  /** 可执行类文件的确认框；用户确认时为 true */
  confirmExecutable: (name: string) => Promise<boolean>
  notify: (message: string, type: ToastType) => void
  /** 应用自身的文案（错误码、提示） */
  t: (key: string, vars?: Record<string, unknown>) => string
  /** 插件自带语言资源的查找 */
  pluginT: (key: string, vars?: Record<string, unknown>) => string
  language: string
  theme: 'light' | 'dark'
  settings: Partial<HostSettings> | undefined
  /** 标签所属工作区的 folder 条目的根 URI（fs.rootOf 用） */
  roots: readonly string[]
  /** 标签当前位置按逻辑路径的上一级（lib/logical-path.ts 的 parentLocation；tabs.up 用），没有时为 null */
  parent: TabLocation | null
}

/** 插件可读取的设置键（plugin-sdk 的 HostSettings）：其余设置即使传入也读不到 */
const HOST_SETTING_KEYS: ReadonlySet<string> = new Set<keyof HostSettings>([
  'explorer.showHiddenFiles'
])

/** URI 最后一段的显示名（百分号解码失败时保留原样；驱动器根 file:///C:/ 为 C:） */
function nameOfUri(uri: string): string {
  const path = URL.canParse(uri) ? new URL(uri).pathname : uri
  const last = path.split('/').filter(Boolean).pop() ?? uri
  try {
    return decodeURIComponent(last)
  } catch {
    return last
  }
}

/**
 * 预览插件的宿主（plugin-sdk 的 PreviewHost）：插件只能经它访问文件系统、标签与系统操作。
 * - tabs.navigate / up 在本标签内导航（进入历史），tabs.open 开新标签（M1-3b 起没有预览标签，设计 2.8）。
 * - system.* 失败时以 toast 提示错误码对应的文案，Promise 不拒绝（插件不必处理错误）。
 * - 「用系统应用打开」对可执行类扩展名先确认（设计 3.3），取消时不调用 system.openPath。
 */
export function createPreviewHost(deps: PreviewHostDeps): PreviewHost {
  const { invoke, tabId } = deps
  const describeError = (e: unknown): string =>
    deps.t(`errors:${e instanceof AppError ? e.code : 'UNKNOWN'}`)
  const reportError = (e: unknown): void => deps.notify(describeError(e), 'error')
  /**
   * 标签的类型与标题：插件给出类型时直接用（标题取 URI 的最后一段），
   * 否则 stat 目标（stat 跟随链接，链接按目标类型）
   */
  const target = async (uri: string, kind?: 'file' | 'directory'): Promise<TabTarget> => {
    if (kind !== undefined) return { uri, kind, title: nameOfUri(uri) }
    const stat = await invoke('vfs.stat', { uri })
    return { uri, kind: stat.kind === 'directory' ? 'directory' : 'file', title: stat.name }
  }

  return {
    fs: {
      stat: (uri) => invoke('vfs.stat', { uri }),
      // 断开以 reachability-store 为准：扫描进程断开后的列表本就是 offline；
      // 已在缓存中的列表（断开之前取得）也按断开显示
      list: async (uri) => {
        const listing = await deps.listDirectory(uri)
        return deps.isOffline(uri) ? { ...listing, state: 'offline' } : listing
      },
      refresh: (uri) => deps.refreshDirectory(uri),
      subscribe: (uri, onChange) =>
        deps.onVfsChanged((changed) => {
          if (changed === uri) onChange()
        }),
      toDisplayPath: (uri) => fileUriToWindowsPath(uri) ?? uri,
      rootOf: (uri) => {
        let best: string | null = null
        for (const root of deps.roots) {
          if (isUnderUri(uri, root) && (best === null || root.length > best.length)) best = root
        }
        return best
      }
    },
    tabs: {
      open: (uri) => {
        const workspaceId = deps.workspaceId
        if (workspaceId === undefined) return
        target(uri)
          .then((t) => deps.tabs.open(workspaceId, t))
          .catch(reportError)
      },
      navigate: (uri, kind) => {
        target(uri, kind)
          .then((t) => deps.tabs.navigate(tabId, t))
          .catch(reportError)
      },
      up: () => {
        const parent = deps.parent
        if (parent === null) return
        deps.tabs.navigate(tabId, parent)
      },
      onRefresh: (listener) => deps.onRefresh(listener)
    },
    system: {
      revealInOs: (uri) => {
        invoke('system.revealInOs', { uri }).catch(reportError)
      },
      copyPath: async (uri) => {
        try {
          await invoke('system.copyText', { text: fileUriToWindowsPath(uri) ?? uri })
          deps.notify(deps.t('preview:copiedPath'), 'success')
        } catch (e) {
          reportError(e)
        }
      },
      openWithSystem: async (uri) => {
        try {
          const name = nameOfUri(uri)
          if (isExecutableExtension(name) && !(await deps.confirmExecutable(name))) return
          await invoke('system.openPath', { uri })
        } catch (e) {
          reportError(e)
        }
      }
    },
    ui: {
      toast: (message, type = 'info') => deps.notify(message, type)
    },
    i18n: { t: deps.pluginT, language: deps.language, describeError },
    theme: { mode: deps.theme },
    settings: { get: (key) => (HOST_SETTING_KEYS.has(key) ? deps.settings?.[key] : undefined) }
  }
}
