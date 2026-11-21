import {
  Fragment,
  Suspense,
  use,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type JSX,
  type ReactNode
} from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { TriangleAlertIcon, UnplugIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { i18n as I18n } from 'i18next'
import {
  FALLBACK_PLUGIN_ID,
  type AnyPreviewPlugin,
  type PreviewProps,
  type ResourceInfo,
  type ViewerCandidate
} from '@pch/plugin-sdk'
import { AppError, type FileStat, type TabState } from '@pch/shared'
import { Button } from '@pch/ui/components/button'
import { Spinner } from '@pch/ui/components/spinner'
import { useEntries } from '@renderer/data/entries'
import { useSettings } from '@renderer/data/settings'
import { fetchDirectory, retryDirectory, useResourceStat } from '@renderer/data/vfs'
import { webEvents } from '@renderer/data/web'
import { useActiveWorkspace, workspaceDisplayName } from '@renderer/data/workspace'
import { isShareOffline } from '@renderer/lib/file-uri'
import { call, subscribe } from '@renderer/lib/ipc'
import { parentLocation } from '@renderer/lib/logical-path'
import { useOverlayOpen } from '@renderer/lib/overlay-tracker'
import { reportError } from '@renderer/lib/report-error'
import { useResolvedTheme } from '@renderer/providers/theme-context'
import { useReachabilityStore } from '@renderer/stores/reachability-store'
import { notify, useMessagesStore } from '@renderer/stores/messages-store'
import { findTab, onTabRefresh, useTabsStore } from '@renderer/stores/tabs-store'
import { useViewerStore } from '@renderer/stores/viewer-store'
import { ConfirmExecutableDialog } from './confirm-executable-dialog'
import { createPreviewHost } from './host'
import { PluginErrorBoundary } from './plugin-error-boundary'
import { candidatesFor, extensionOf, needsSniff, resolvePlugin } from './registry'
import { useDocSession } from './use-doc-session'
import { useSniff } from './use-sniff'
import { createWebHost, createWebViews, type WebHost, type WebViews } from './web-host'
import { WorkspaceOverview } from './workspace-overview'

export interface PreviewContainerProps {
  tab: TabState
  /** 注册表中的插件（含 fallback），由 app/ 组合传入 */
  plugins: readonly AnyPreviewPlugin[]
}

export interface PreviewContainerRootProps extends PreviewContainerProps {
  /**
   * 工作区一览（kind 为 workspaces）的内置视图：在 features/workspace 中（要用工作区的对话框），
   * 由 app/ 组合传入（feature 之间不互相 import）
   */
  renderWorkspaces: (tab: TabState) => ReactNode
}

/**
 * 标签内容（doc 9.3）：工作区总览（kind 为 workspace）显示内置视图 WorkspaceOverview，
 * 工作区一览（kind 为 workspaces）显示 app/ 传入的内置视图（renderWorkspaces）；
 * 其余取得资源描述 → 注册表选择插件（没有插件按扩展名 / MIME 匹配的文件先 vfs.sniff，文本交给 textLike 插件）
 * → 懒加载插件组件。
 * 目录标签不等 stat：用标签的类型与标题构造资源描述交给插件（folder 插件的 fs.list 缓存优先：
 * 共享断开 / 无响应时立即显示缓存与「已断开」，目录不在了显示「找不到」）；文件标签 stat 后显示，
 * 所在共享在 reachability-store 中为断开时不发 stat（会等到超时），只显示文件名与「已断开」。
 * 每个标签一层 ErrorBoundary + Suspense：插件抛错或懒加载失败只在该标签显示错误面板，
 * 并提供「以文件信息显示」（fallback 插件）的出口。
 * 查看器（tab.viewer，用户为该位置选的插件 id）是标签状态、随位置进入历史：导航到新位置时清除，后退 / 前进恢复；
 * 选了查看器时不 sniff；没选时先看设置 preview.associations，再按注册表自动选择（registry.resolvePlugin）。
 * 预览标签只在插件调用宿主的动作（host.ts 的 interacted）或双击标签头时转为常驻；
 * 标签内的点击、滚动、按键不改变预览状态（控制者裁定）。
 */
export function PreviewContainer({
  tab,
  plugins,
  renderWorkspaces
}: PreviewContainerRootProps): JSX.Element {
  // 工作区总览 / 一览不经插件：该标签若还有浏览器视图（从网页导航过来）则销毁
  const builtin = tab.kind === 'workspace' || tab.kind === 'workspaces'
  useLayoutEffect(() => {
    if (builtin) getWebViews().release(tab.id)
  }, [builtin, tab.id])
  let content: ReactNode
  if (tab.kind === 'workspace') content = <WorkspaceOverview key={tab.uri} tab={tab} />
  else if (tab.kind === 'workspaces')
    content = <Fragment key={tab.uri}>{renderWorkspaces(tab)}</Fragment>
  else content = <ResourcePreview key={tab.uri} tab={tab} plugins={plugins} />
  return (
    // 同一标签内导航到另一位置时整体重建（sniff 结果等状态不沿用；viewer 在标签状态中，随位置变化）
    <div className="h-full min-h-0">{content}</div>
  )
}

function ResourcePreview({ tab, plugins }: PreviewContainerProps): JSX.Element {
  // 目录没有选查看器时不 stat；选了（如「文件信息」）要 stat 才有大小与时间
  if (tab.kind === 'directory' && tab.viewer === undefined) {
    return <SelectPlugin tab={tab} plugins={plugins} resource={directoryResource(tab)} />
  }
  return <StatResource tab={tab} plugins={plugins} />
}

/** 目录标签的资源描述：不 stat，名称取标签的标题（大小与时间为 0，folder 插件不使用） */
function directoryResource(tab: TabState): ResourceInfo {
  return { uri: tab.uri, name: tab.title, kind: 'directory', size: 0, mtime: 0, mime: null }
}

/** 设置 preview.associations 未读到时（加载中）的空关联（引用稳定） */
const NO_ASSOCIATIONS: Readonly<Record<string, string>> = {}

function StatResource(props: PreviewContainerProps): JSX.Element {
  const { tab } = props
  const { t } = useTranslation()
  const offline = useReachabilityStore((s) => isShareOffline(tab.uri, s.offlineShares))
  const stat = useResourceStat(tab.uri, !offline)
  // 刷新（地址栏 / F5）：重新 stat（不受新鲜期限制），插件随新的资源描述重新渲染；断开时不发
  const { refetch } = stat
  useEffect(
    () =>
      onTabRefresh(tab.id, () => {
        if (!offline) void refetch()
      }),
    [tab.id, offline, refetch]
  )
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
    const failure = (
      <Centered>
        <p role="alert" className="text-sm text-muted-foreground">
          {t(`errors:${code}`)}
        </p>
        <Button variant="outline" onClick={() => void stat.refetch()}>
          {t('preview:retry')}
        </Button>
      </Centered>
    )
    // 显示中的文件被删除：自己处理「文件已不存在」的插件（manifest.handlesMissing）继续显示。
    // 与下面的正常分支在同一位置渲染 SelectPlugin，插件不重新挂载（日志轮转时保留状态）
    if (code === 'FS_NOT_FOUND' && stat.data !== undefined) {
      return (
        <SelectPlugin {...props} resource={toResourceInfo(stat.data, tab)} whenMissing={failure} />
      )
    }
    return failure
  }
  if (stat.data === undefined) return <Loading />
  return <SelectPlugin {...props} resource={toResourceInfo(stat.data, tab)} />
}

/**
 * 选择插件：没有插件按扩展名 / MIME 匹配的文件先 sniff（显示加载中），
 * 判为文本时 resource.textLike = true（交给 textLike 插件），否则 false（fallback）。选了查看器时不 sniff
 */
function SelectPlugin({
  whenMissing,
  ...props
}: PreviewContainerProps & {
  resource: ResourceInfo
  /** 文件已不存在：选中的插件不处理时显示它（manifest.handlesMissing） */
  whenMissing?: ReactNode
}): JSX.Element {
  const { plugins, resource, tab } = props
  const { data: settings } = useSettings()
  const viewer = tab.viewer ?? null
  const associations = settings?.['preview.associations'] ?? NO_ASSOCIATIONS
  const needed = viewer === null && needsSniff(plugins, resource)
  const sniffed = useSniff(resource.uri, needed)
  const show = (view: ResourceInfo, plugin: AnyPreviewPlugin): JSX.Element =>
    whenMissing !== undefined && plugin.manifest.handlesMissing !== true ? (
      <>{whenMissing}</>
    ) : (
      <PluginView {...props} resource={view} plugin={plugin} />
    )
  if (!needed) return show(resource, resolvePlugin(plugins, resource, { viewer, associations }))
  if (sniffed === undefined) return whenMissing !== undefined ? <>{whenMissing}</> : <Loading />
  const sniffedResource = { ...resource, textLike: sniffed === 'text' }
  return show(sniffedResource, resolvePlugin(plugins, sniffedResource, { viewer, associations }))
}

/** stat → 插件看到的资源描述（链接已由 stat 跟随；kind 只有 file / directory） */
function toResourceInfo(stat: FileStat, tab: TabState): ResourceInfo {
  const kind = stat.kind !== 'symlink' ? stat.kind : tab.kind === 'directory' ? 'directory' : 'file'
  return { uri: tab.uri, name: stat.name, kind, size: stat.size, mtime: stat.mtime, mime: null }
}

/**
 * 本窗口的浏览器视图登记（首次需要时创建）：按标签串行的 web.* 调用、视图状态的回放，
 * 以及标签关闭（含未激活的标签）时的 web.release（分层规则不允许 stores 调用 IPC，放在这里订阅 tabs-store）
 */
let webViews: WebViews | null = null
function getWebViews(): WebViews {
  webViews ??= createWebViews({
    invoke: call,
    events: webEvents,
    onTabsChange: (listener) => useTabsStore.subscribe(listener),
    tabExists: (tabId) => findTab(useTabsStore.getState(), tabId) !== null,
    onError: (e) => reportError(e, 'web view')
  })
  return webViews
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
  resource,
  plugin
}: PreviewContainerProps & { resource: ResourceInfo; plugin: AnyPreviewPlugin }): JSX.Element {
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
  // 「上一级」（host.tabs.up）：按逻辑路径，条目根之上是工作区总览
  const workspaceName = workspace
    ? workspaceDisplayName(workspace, t('common:defaultWorkspace'))
    : undefined
  const workspacesTitle = t('workspace:listPage')
  const parent = useMemo(
    () =>
      workspace === undefined || workspaceName === undefined
        ? null
        : parentLocation(
            { uri: tab.uri, kind: tab.kind, title: tab.title },
            {
              workspace: { id: workspace.id, name: workspaceName },
              workspacesTitle,
              entries: entries ?? []
            }
          ),
    [workspace, workspaceName, workspacesTitle, entries, tab.uri, tab.kind, tab.title]
  )
  const offlineShares = useReachabilityStore((s) => s.offlineShares)
  const open = useTabsStore((s) => s.open)
  const navigate = useTabsStore((s) => s.navigate)
  const setViewState = useTabsStore((s) => s.setViewState)
  const setViewer = useTabsStore((s) => s.setViewer)
  const [confirm, setConfirm] = useState<PendingConfirm | null>(null)
  const doc = useDocSession(tab.id, settings)
  // 浏览器视图（host.web）：每个标签内容一个，宿主重建（主题、条目变化等）时不重建——否则视图会隐藏后重新显示。
  // 它用到的条目根 / tabs / 错误提示在布局阶段换成最新的（setLinks，早于插件 useEffect 中的 attach）
  const tabId = tab.id
  const webHost = useMemo(
    () =>
      createWebHost({
        tabId,
        views: getWebViews(),
        invoke: call,
        events: webEvents,
        roots: [],
        tabs: { open: () => undefined, navigate: () => undefined },
        onError: (e) => reportError(e, 'web view'),
        onRefresh: (listener) => onTabRefresh(tabId, listener),
        stashToasts: () => useMessagesStore.getState().stashVisible()
      }),
    [tabId]
  )

  const pluginId = plugin.manifest.id
  // 候选查看器的 id（字符串：toResourceInfo 每次渲染都是新对象，宿主不能依赖 resource，只依赖候选是否变化）
  const candidateIds = candidatesFor(plugins, resource)
    .map((p) => p.manifest.id)
    .join(',')
  const language = i18n.language

  // 候选的显示名按插件自带的语言资源翻译（先登记资源）；语言变化时重算
  const candidates = useMemo(
    () =>
      candidateIds.split(',').map((id): ViewerCandidate => {
        const candidate = plugins.find((p) => p.manifest.id === id)!
        registerPluginResources(i18n, candidate)
        return {
          id,
          name: i18n.getFixedT(language, id)(candidate.manifest.name),
          current: id === pluginId
        }
      }),
    [i18n, plugins, candidateIds, pluginId, language]
  )
  // 写入 viewer-store 供地址栏的查看器下拉使用（文件才有扩展名；卸载 / 换标签时清除）
  const setViewers = useViewerStore((s) => s.setFor)
  const clearViewers = useViewerStore((s) => s.clear)
  const ext = resource.kind === 'file' ? extensionOf(resource.name) : null
  useEffect(() => {
    setViewers(tab.id, { candidates, ext })
  }, [setViewers, tab.id, candidates, ext])
  useEffect(() => () => clearViewers(tab.id), [clearViewers, tab.id])

  const host = useMemo(() => {
    registerPluginResources(i18n, plugin)
    const pluginT = i18n.getFixedT(null, pluginId)
    return createPreviewHost({
      tabId: tab.id,
      workspaceId: workspace?.id,
      invoke: call,
      listDirectory: (uri) => fetchDirectory(queryClient, uri),
      refreshDirectory: (uri) => retryDirectory(queryClient, uri),
      // 断开状态变化时宿主重建：插件随之重新列出（folder 插件的状态行切换「已断开」）
      isOffline: (uri) => isShareOffline(uri, offlineShares),
      onVfsChanged: (listener) => subscribe('vfs.changed', ({ uri }) => listener(uri)),
      onRefresh: (listener) => onTabRefresh(tab.id, listener),
      doc,
      web: webHost.api,
      viewer: {
        candidates: () => candidates,
        set: (id) => setViewer(tab.id, id),
        selected: () => findTab(useTabsStore.getState(), tab.id)?.viewer ?? null
      },
      tabs: { open, navigate },
      confirmExecutable: (name) =>
        new Promise<boolean>((resolve) => setConfirm({ name, resolve, settled: false })),
      notify: (message, type) => notify(type, message),
      t: (key, vars) => t(key, vars ?? {}),
      pluginT: (key, vars) => pluginT(key, vars ?? {}),
      language,
      theme,
      settings,
      roots,
      parent
    })
  }, [
    i18n,
    plugin,
    pluginId,
    tab.id,
    workspace?.id,
    queryClient,
    doc,
    webHost,
    candidates,
    setViewer,
    offlineShares,
    open,
    navigate,
    t,
    language,
    theme,
    settings,
    roots,
    parent
  ])

  // 当前位置与实际解析出的查看器（布局阶段：早于插件 attach，插件仍在懒加载时也生效）。
  // 该标签的视图属于另一个查看器 → 销毁（当前位置不再用那个网页查看器）
  const resourceUri = resource.uri
  useLayoutEffect(() => {
    webHost.setLocation({ pluginId, uri: resourceUri })
  }, [webHost, pluginId, resourceUri])
  useLayoutEffect(() => {
    webHost.setLinks({
      roots,
      tabs: host.tabs,
      onError: (e) => host.ui.toast(host.i18n.describeError(e), 'error')
    })
  }, [webHost, host, roots])

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
              <Button variant="outline" onClick={() => setViewer(tab.id, FALLBACK_PLUGIN_ID)}>
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
            onViewStateChange={(state) => setViewState(tab.id, state, tab.uri)}
          />
        </Suspense>
      </PluginErrorBoundary>
      <WebCover webHost={webHost} />
      <ConfirmExecutableDialog
        open={confirm !== null && !confirm.settled}
        name={confirm?.name ?? ''}
        onResult={settle}
      />
    </>
  )
}

/**
 * 应用的弹出层或 toast 盖在视图区域上时，浏览器视图换成截图（设计 5.3.7 / 5.9）。
 * 单独一个不渲染内容的组件：弹出层 / toast 的变化只让它重新渲染，不波及插件
 */
function WebCover({ webHost }: { webHost: WebHost }): null {
  const overlayOpen = useOverlayOpen()
  const toastsVisible = useMessagesStore((s) => s.visible.length > 0)
  useEffect(() => {
    webHost.setCovered({ overlay: overlayOpen, toasts: toastsVisible })
  }, [webHost, overlayOpen, toastsVisible])
  return null
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
