import { Suspense, use, useMemo, useState, type JSX, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { TriangleAlertIcon, UnplugIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import type { i18n as I18n } from 'i18next'
import {
  FALLBACK_PLUGIN_ID,
  type AnyPreviewPlugin,
  type PreviewProps,
  type ResourceInfo
} from '@pch/plugin-sdk'
import { AppError, type FileStat, type TabState } from '@pch/shared'
import { Button } from '@pch/ui/components/button'
import { Spinner } from '@pch/ui/components/spinner'
import { useEntries } from '@renderer/data/entries'
import { useSettings } from '@renderer/data/settings'
import { fetchDirectory, useResourceStat } from '@renderer/data/vfs'
import { useActiveWorkspace } from '@renderer/data/workspace'
import { isShareOffline } from '@renderer/lib/file-uri'
import { call, subscribe } from '@renderer/lib/ipc'
import { reportError } from '@renderer/lib/report-error'
import { useResolvedTheme } from '@renderer/providers/theme-context'
import { useReachabilityStore } from '@renderer/stores/reachability-store'
import { useTabsStore } from '@renderer/stores/tabs-store'
import { ConfirmExecutableDialog } from './confirm-executable-dialog'
import { createPreviewHost } from './host'
import { PluginErrorBoundary } from './plugin-error-boundary'
import { fallbackOf, pickPlugin } from './registry'

export interface PreviewContainerProps {
  tab: TabState
  /** 注册表中的插件（含 fallback），由 app/ 组合传入 */
  plugins: readonly AnyPreviewPlugin[]
}

/**
 * 标签内容（doc 9.3）：取得资源描述 → 注册表选择插件 → 懒加载插件组件。
 * 目录标签不等 stat：用标签的类型与标题构造资源描述交给插件（folder 插件的 fs.list 缓存优先：
 * 共享断开 / 无响应时立即显示缓存与「已断开」，目录不在了显示「找不到」）；文件标签 stat 后显示，
 * 所在共享在 reachability-store 中为断开时不发 stat（会等到超时），只显示文件名与「已断开」。
 * 每个标签一层 ErrorBoundary + Suspense：插件抛错或懒加载失败只在该标签显示错误面板，
 * 并提供「以文件信息显示」（fallback 插件）的出口。
 * 预览标签只在插件调用宿主的动作（host.ts 的 interacted）或双击标签头时转为常驻；
 * 标签内的点击、滚动、按键不改变预览状态（控制者裁定）。
 */
export function PreviewContainer({ tab, plugins }: PreviewContainerProps): JSX.Element {
  return (
    <div className="h-full min-h-0">
      {/* 同一标签内导航到另一资源时整体重建（「以文件信息显示」等状态不沿用） */}
      <ResourcePreview key={tab.uri} tab={tab} plugins={plugins} />
    </div>
  )
}

function ResourcePreview({ tab, plugins }: PreviewContainerProps): JSX.Element {
  // 「以文件信息显示」（fallback 插件）：目录也要 stat 才有大小与时间
  const [showInfo, setShowInfo] = useState(false)
  const view = { tab, plugins, showInfo, onShowInfo: () => setShowInfo(true) }
  if (tab.kind === 'directory' && !showInfo) {
    return <PluginView {...view} resource={directoryResource(tab)} />
  }
  return <StatResource {...view} />
}

/** 目录标签的资源描述：不 stat，名称取标签的标题（大小与时间为 0，folder 插件不使用） */
function directoryResource(tab: TabState): ResourceInfo {
  return { uri: tab.uri, name: tab.title, kind: 'directory', size: 0, mtime: 0, mime: null }
}

type ViewProps = PreviewContainerProps & { showInfo: boolean; onShowInfo: () => void }

function StatResource(props: ViewProps): JSX.Element {
  const { tab } = props
  const { t } = useTranslation()
  const offline = useReachabilityStore((s) => isShareOffline(tab.uri, s.offlineShares))
  const stat = useResourceStat(tab.uri, !offline)
  if (offline) {
    return (
      <Centered>
        <UnplugIcon aria-hidden className="size-8 text-muted-foreground" />
        <h2 className="text-base font-medium break-all">{tab.title}</h2>
        <p role="status" className="text-sm text-muted-foreground">
          {t('preview:offline')}
        </p>
      </Centered>
    )
  }
  // 错误优先于数据：重新取得失败时 TanStack Query 保留旧 data（knowledge/libraries.md）
  if (stat.isError) {
    const code = stat.error instanceof AppError ? stat.error.code : 'UNKNOWN'
    return (
      <Centered>
        <p role="alert" className="text-sm text-muted-foreground">
          {t(`errors:${code}`)}
        </p>
        <Button variant="outline" onClick={() => void stat.refetch()}>
          {t('preview:retry')}
        </Button>
      </Centered>
    )
  }
  if (stat.data === undefined) return <Loading />
  return <PluginView {...props} resource={toResourceInfo(stat.data, tab)} />
}

/** stat → 插件看到的资源描述（链接已由 stat 跟随；kind 只有 file / directory） */
function toResourceInfo(stat: FileStat, tab: TabState): ResourceInfo {
  const kind = stat.kind === 'symlink' ? tab.kind : stat.kind
  return { uri: tab.uri, name: stat.name, kind, size: stat.size, mtime: stat.mtime, mime: null }
}

type PluginModule = Awaited<ReturnType<AnyPreviewPlugin['load']>>
/**
 * 每个插件只加载一次（缓存 Promise，供 use() 在 Suspense 中等待）。
 * 失败的加载直到重新加载窗口都保持失败（错误面板提供 fallback 出口）。
 */
const modules = new Map<string, Promise<PluginModule>>()
function loadPlugin(plugin: AnyPreviewPlugin): Promise<PluginModule> {
  let loading = modules.get(plugin.manifest.id)
  if (!loading) {
    loading = plugin.load()
    modules.set(plugin.manifest.id, loading)
  }
  return loading
}

/** 等待插件模块加载（Suspense），渲染其默认导出的组件；加载失败时抛给错误边界 */
function PluginBody({
  plugin,
  ...props
}: PreviewProps & { plugin: AnyPreviewPlugin }): JSX.Element {
  const { default: Body } = use(loadPlugin(plugin))
  return <Body {...props} />
}

/** 把插件自带的语言资源登记为以插件 id 命名的 i18next 命名空间（已登记则跳过） */
function registerPluginResources(i18n: I18n, plugin: AnyPreviewPlugin): void {
  for (const [language, messages] of Object.entries(plugin.i18n ?? {})) {
    if (!i18n.hasResourceBundle(language, plugin.manifest.id)) {
      i18n.addResourceBundle(language, plugin.manifest.id, messages)
    }
  }
}

interface PendingConfirm {
  name: string
  resolve: (confirmed: boolean) => void
  /** 已有结果（对话框关闭中，名称保留到动画结束） */
  settled: boolean
}

function PluginView({
  tab,
  plugins,
  showInfo,
  onShowInfo,
  resource
}: ViewProps & { resource: ResourceInfo }): JSX.Element {
  const { t, i18n } = useTranslation()
  const queryClient = useQueryClient()
  const theme = useResolvedTheme()
  const { data: settings } = useSettings()
  const { data: workspace } = useActiveWorkspace()
  const { data: entries } = useEntries(workspace?.id)
  const roots = useMemo(
    () => (entries ?? []).flatMap((e) => (e.kind === 'folder' && e.uri !== null ? [e.uri] : [])),
    [entries]
  )
  const offlineShares = useReachabilityStore((s) => s.offlineShares)
  const open = useTabsStore((s) => s.open)
  const navigate = useTabsStore((s) => s.navigate)
  const promote = useTabsStore((s) => s.promote)
  const setViewState = useTabsStore((s) => s.setViewState)
  const [confirm, setConfirm] = useState<PendingConfirm | null>(null)

  const plugin = showInfo ? fallbackOf(plugins) : pickPlugin(plugins, resource)
  const pluginId = plugin.manifest.id
  const language = i18n.language

  const host = useMemo(() => {
    registerPluginResources(i18n, plugin)
    const pluginT = i18n.getFixedT(null, pluginId)
    return createPreviewHost({
      tabId: tab.id,
      workspaceId: workspace?.id,
      invoke: call,
      listDirectory: (uri) => fetchDirectory(queryClient, uri),
      // 断开状态变化时宿主重建：插件随之重新列出（folder 插件的状态行切换「已断开」）
      isOffline: (uri) => isShareOffline(uri, offlineShares),
      onVfsChanged: (listener) => subscribe('vfs.changed', ({ uri }) => listener(uri)),
      tabs: { open, navigate, promote },
      confirmExecutable: (name) =>
        new Promise<boolean>((resolve) => setConfirm({ name, resolve, settled: false })),
      notify: (message, type) => toast[type](message),
      t: (key, vars) => t(key, vars ?? {}),
      pluginT: (key, vars) => pluginT(key, vars ?? {}),
      language,
      theme,
      settings,
      roots
    })
  }, [
    i18n,
    plugin,
    pluginId,
    tab.id,
    workspace?.id,
    queryClient,
    offlineShares,
    open,
    navigate,
    promote,
    t,
    language,
    theme,
    settings,
    roots
  ])

  const settle = (confirmed: boolean): void => {
    if (!confirm || confirm.settled) return
    confirm.resolve(confirmed)
    setConfirm({ ...confirm, settled: true })
  }

  const pluginName = i18n.getFixedT(null, pluginId)(plugin.manifest.name)

  return (
    <>
      <PluginErrorBoundary
        key={pluginId}
        onError={(error, info) =>
          reportError(error, `preview plugin ${pluginId}\n${info.componentStack ?? ''}`)
        }
        fallback={() => (
          <Centered>
            <div role="alert" className="flex max-w-md flex-col items-center gap-2 text-center">
              <TriangleAlertIcon aria-hidden className="size-8 text-muted-foreground" />
              <h2 className="text-base font-medium">{t('preview:errorTitle')}</h2>
              <p className="text-sm text-muted-foreground">
                {t('preview:errorHint', { plugin: pluginName })}
              </p>
            </div>
            {pluginId === FALLBACK_PLUGIN_ID ? null : (
              <Button variant="outline" onClick={onShowInfo}>
                {t('preview:showInfo')}
              </Button>
            )}
          </Centered>
        )}
      >
        <Suspense fallback={<Loading />}>
          <PluginBody
            plugin={plugin}
            resource={resource}
            host={host}
            viewState={tab.viewState}
            onViewStateChange={(state) => setViewState(tab.id, state)}
          />
        </Suspense>
      </PluginErrorBoundary>
      <ConfirmExecutableDialog
        open={confirm !== null && !confirm.settled}
        name={confirm?.name ?? ''}
        onResult={settle}
      />
    </>
  )
}

function Centered({ children }: { children: ReactNode }): JSX.Element {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-6">{children}</div>
  )
}

function Loading(): JSX.Element {
  const { t } = useTranslation('preview')
  return (
    <Centered>
      <Spinner aria-label={t('loading')} />
    </Centered>
  )
}
