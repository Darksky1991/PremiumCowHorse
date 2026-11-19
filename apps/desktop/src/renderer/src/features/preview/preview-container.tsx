import { Suspense, use, useMemo, useState, type JSX, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { TriangleAlertIcon } from 'lucide-react'
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
import { useSettings } from '@renderer/data/settings'
import { fetchDirectory, useResourceStat } from '@renderer/data/vfs'
import { useActiveWorkspace } from '@renderer/data/workspace'
import { call, subscribe } from '@renderer/lib/ipc'
import { reportError } from '@renderer/lib/report-error'
import { useResolvedTheme } from '@renderer/providers/theme-context'
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
 * 标签内容（doc 9.3）：stat 资源 → 注册表选择插件 → 懒加载插件组件。
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
  const { t } = useTranslation()
  const stat = useResourceStat(tab.uri)
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
  return <PluginView tab={tab} plugins={plugins} resource={toResourceInfo(stat.data, tab)} />
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
  resource
}: PreviewContainerProps & { resource: ResourceInfo }): JSX.Element {
  const { t, i18n } = useTranslation()
  const queryClient = useQueryClient()
  const theme = useResolvedTheme()
  const { data: settings } = useSettings()
  const { data: workspace } = useActiveWorkspace()
  const open = useTabsStore((s) => s.open)
  const navigate = useTabsStore((s) => s.navigate)
  const promote = useTabsStore((s) => s.promote)
  const setViewState = useTabsStore((s) => s.setViewState)
  const [showInfo, setShowInfo] = useState(false)
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
      onVfsChanged: (listener) => subscribe('vfs.changed', ({ uri }) => listener(uri)),
      tabs: { open, navigate, promote },
      confirmExecutable: (name) =>
        new Promise<boolean>((resolve) => setConfirm({ name, resolve, settled: false })),
      notify: (message, type) => toast[type](message),
      t: (key, vars) => t(key, vars ?? {}),
      pluginT: (key, vars) => pluginT(key, vars ?? {}),
      language,
      theme,
      settings
    })
  }, [
    i18n,
    plugin,
    pluginId,
    tab.id,
    workspace?.id,
    queryClient,
    open,
    navigate,
    promote,
    t,
    language,
    theme,
    settings
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
              <Button variant="outline" onClick={() => setShowInfo(true)}>
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
