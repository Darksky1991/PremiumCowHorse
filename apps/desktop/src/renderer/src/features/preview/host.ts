import type { HostSettings, PreviewHost, ToastType } from '@pch/plugin-sdk'
import { AppError, isUnderUri, type DirectoryListing } from '@pch/shared'
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
  /** 订阅 vfs.changed，回调参数为变化的目录 URI；返回取消订阅函数 */
  onVfsChanged: (listener: (uri: string) => void) => () => void
  tabs: {
    open: (workspaceId: string, target: TabTarget & { preview: boolean }) => void
    navigate: (id: string, target: TabTarget) => void
    promote: (id: string) => void
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
}

/** 插件可读取的设置键（plugin-sdk 的 HostSettings）：其余设置即使传入也读不到 */
const HOST_SETTING_KEYS: ReadonlySet<string> = new Set<keyof HostSettings>([
  'explorer.showHiddenFiles'
])

/** URI 最后一段的显示名（百分号解码失败时保留原样） */
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
 * - 插件调用 tabs.* / system.* 视为在标签内交互：所在的预览标签转为常驻（设计第 2 节）。
 * - system.* 失败时以 toast 提示错误码对应的文案，Promise 不拒绝（插件不必处理错误）。
 * - 「用系统应用打开」对可执行类扩展名先确认（设计 3.3），取消时不调用 system.openPath。
 */
export function createPreviewHost(deps: PreviewHostDeps): PreviewHost {
  const { invoke, tabId } = deps
  const interacted = (): void => deps.tabs.promote(tabId)
  const describeError = (e: unknown): string =>
    deps.t(`errors:${e instanceof AppError ? e.code : 'UNKNOWN'}`)
  const reportError = (e: unknown): void => deps.notify(describeError(e), 'error')
  /** stat 目标得到标签的类型与标题（stat 跟随链接，链接按目标类型） */
  const target = async (uri: string): Promise<TabTarget> => {
    const stat = await invoke('vfs.stat', { uri })
    return { uri, kind: stat.kind === 'directory' ? 'directory' : 'file', title: stat.name }
  }

  return {
    fs: {
      stat: (uri) => invoke('vfs.stat', { uri }),
      list: (uri) => deps.listDirectory(uri),
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
      open: (uri, opts) => {
        interacted()
        const workspaceId = deps.workspaceId
        if (workspaceId === undefined) return
        target(uri)
          .then((t) => deps.tabs.open(workspaceId, { ...t, preview: opts?.preview ?? false }))
          .catch(reportError)
      },
      navigate: (uri) => {
        interacted()
        target(uri)
          .then((t) => deps.tabs.navigate(tabId, t))
          .catch(reportError)
      }
    },
    system: {
      revealInOs: (uri) => {
        interacted()
        invoke('system.revealInOs', { uri }).catch(reportError)
      },
      copyPath: async (uri) => {
        interacted()
        try {
          await invoke('system.copyText', { text: fileUriToWindowsPath(uri) ?? uri })
          deps.notify(deps.t('preview:copiedPath'), 'success')
        } catch (e) {
          reportError(e)
        }
      },
      openWithSystem: async (uri) => {
        interacted()
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
