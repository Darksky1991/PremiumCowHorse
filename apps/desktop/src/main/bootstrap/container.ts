import path from 'node:path'
import { hostname } from 'node:os'
import { app, net, session, shell } from 'electron'
import type { i18n } from 'i18next'
import { resolveLanguage } from '@pch/shared'
import { EventBus } from '../core/event-bus'
import type { MainEvents } from '../core/events'
import { openDatabase, type Database } from '../infra/db/client'
import { createMainI18n } from '../infra/i18n'
import { createLogger, type Logger } from '../infra/logger'
import { createPaths, type AppPaths } from '../infra/paths'
import { SettingsRepo } from '../modules/settings/settings.repo'
import { SettingsService } from '../modules/settings/settings.service'
import { WindowService } from '../windows/window.service'
import { WorkspaceService } from '../modules/workspace/workspace.service'
import { LocalProvider } from '../vfs/providers/local.provider'
import { location } from '../vfs/location'
import { ScannerClient } from '../vfs/scanner-client'
import { forkScanner } from '../vfs/scanner-process'
import { VfsService } from '../vfs/vfs.service'
import { DocumentService } from '../vfs/document/document-service'
import { LaunchCapabilitiesRepo } from '../modules/launcher/launch-capabilities.repo'
import { LauncherService } from '../modules/launcher/launcher.service'
import { fakeRunPowerShell } from '../modules/launcher/fake-run'
import { runPowerShell } from '../infra/powershell'
import { ScopeTable } from '../modules/web/scope'
import { markdownShell, MARKDOWN_ASSET_BASE } from '../modules/web/markdown-shell'
import {
  createAssetProtocolHandler,
  createWebProtocolHandler,
  type AssetSource
} from '../modules/web/web-protocol'
import { WebViewManager } from '../modules/web/web-view-manager'
import { DESKTOP_TIMINGS } from '../modules/desktop/constants'
import { createExplorerCollector } from '../modules/desktop/collectors/explorer'
import { createOfficeCollector } from '../modules/desktop/collectors/office'
import { createVscodeCollector, readTextFile } from '../modules/desktop/collectors/vscode'
import {
  commandLineViaPowerShell,
  createEclipseCollector
} from '../modules/desktop/collectors/eclipse'
import type { Collector } from '../modules/desktop/collectors/types'
import { DesktopService } from '../modules/desktop/desktop.service'
import { ExitGuard } from '../modules/desktop/exit-guard'
import { createFakeDesktop } from '../modules/desktop/fake'
import { LiveState } from '../modules/desktop/live-state'
import { getLogonTime } from '../modules/desktop/logon'
import { DesktopMonitor } from '../modules/desktop/monitor'
import { existsViaVfs, restoreItems, spawnDetached } from '../modules/desktop/restore'
import { DesktopSnapshotRepo } from '../modules/desktop/snapshot.repo'
import { listWindowsLoadError, loadListWindows } from '../modules/desktop/window-list'
import {
  configureWebSession,
  createWebContentsView,
  WEB_PARTITION
} from '../modules/web/web-session'

export interface Container {
  paths: AppPaths
  logger: Logger
  db: Database
  bus: EventBus<MainEvents>
  settings: SettingsService
  workspaces: WorkspaceService
  vfs: VfsService
  scanner: ScannerClient
  documents: DocumentService
  i18n: i18n
  windows: WindowService
  web: WebViewManager
  launcher: LauncherService
  desktop: DesktopService
  exitGuard: ExitGuard
}

/**
 * 组合根：手动装配所有 service（不引入 DI 框架）。
 * 所有依赖关系在这一个文件里一目了然，测试时可以替换任意依赖。
 */
export async function createContainer(rendererUrl: string): Promise<Container> {
  const paths = createPaths()
  const logger = createLogger(paths)
  const db = await openDatabase(paths.database, logger)
  const bus = new EventBus<MainEvents>()

  const settings = await SettingsService.create(new SettingsRepo(db), bus)
  // 一次性调用（stat、条目添加的校验、降级模式的直接枚举）的超时按位置取 vfs.timeoutSec.*（总时长）
  const vfs = new VfsService([new LocalProvider()], {
    timeoutMs: (uri) => {
      let where: 'local' | 'network' = 'network'
      try {
        where = location(uri)
      } catch {
        // 无法判断位置（例如不规范的 file URI）：按较长的网络超时
      }
      return settings.get(`vfs.timeoutSec.${where}`) * 1000
    }
  })
  const workspaces = new WorkspaceService(db, vfs, bus, app.getPath('temp'))
  // 扫描进程随主进程启动；配置（根、设置）由 bootstrap 在启动与工作区 / 设置变化时下发
  const scanner = new ScannerClient({
    fork: () => forkScanner(logger),
    cacheFile: paths.indexDb,
    onChanged: (uri) => bus.emit('vfs.changed', { uri }),
    onReachability: (e) => bus.emit('vfs.reachability', e),
    log: logger
  })
  scanner.start()
  const i18n = createMainI18n(resolveLanguage(settings.get('general.language'), app.getLocale()))
  const windows = new WindowService(paths, settings, rendererUrl, () => i18n.t('common.appName'))
  // 文本文档：读取经 VfsService（开-读-关、按位置超时）；事件只发给文档所属的窗口
  const documents = new DocumentService({
    source: vfs,
    emit: (owner, event, payload) => windows.sendTo(owner, event, payload),
    fullIndexLimitBytes: () => settings.get('preview.maxTextSizeMB') * 1024 * 1024,
    preferredLanguage: () => resolveLanguage(settings.get('general.language'), app.getLocale())
  })

  // 浏览器视图（doc 第 15 节）：专用会话 + pch-web 协议（范围内只读）；视图归属窗口，事件只发给所属窗口
  const webScopes = new ScopeTable()
  const webSession = session.fromPartition(WEB_PARTITION)
  const web = new WebViewManager({
    createView: (events) => createWebContentsView(webSession, events),
    send: (owner, event, payload) => windows.sendTo(owner, event, payload),
    scopes: webScopes,
    openExternal: (url) => {
      shell.openExternal(url).catch((e: unknown) => logger.warn(`[web] openExternal ${url}`, e))
    },
    logger
  })
  // Markdown 查看脚本（pch-asset）：生产读 out/web-assets/markdown；开发模式代理到 renderer dev server（台账 S9）
  const devServer = /^https?:/.test(rendererUrl) ? rendererUrl : undefined
  const viewerEntry = path.join(paths.webAssets, '../../../src/web-assets/markdown/main.ts')
  const assetSource: AssetSource = devServer
    ? { kind: 'dev', origin: devServer, fetch: (url) => net.fetch(url) }
    : { kind: 'files', root: paths.webAssets }
  const viewerShell = devServer
    ? markdownShell({ script: `${MARKDOWN_ASSET_BASE}@fs/${viewerEntry.replace(/\\/g, '/')}` })
    : markdownShell()
  configureWebSession(webSession, {
    handler: createWebProtocolHandler({ scopes: webScopes, vfs, markdownShell: viewerShell }),
    assetHandler: createAssetProtocolHandler(assetSource),
    onDownload: (id) => web.notifyContents(id, 'download'),
    logger
  })

  const launcher = new LauncherService({
    // 测试用的假 run：打包后的应用绝不启用（与 PCH_E2E_CRASH_PLUGIN 相同，只在未打包时读取环境变量）
    run:
      !app.isPackaged && process.env.PCH_E2E_FAKE_LAUNCHER === '1'
        ? fakeRunPowerShell
        : runPowerShell,
    vfs,
    logger,
    // 机器标识用主机名：数据库随漫游配置文件到别的机器时不沿用那台机器的检测结果
    repo: new LaunchCapabilitiesRepo(db, hostname())
  })

  const { desktop, exitGuard } = createDesktop({ db, vfs, settings, windows, logger })

  return {
    paths,
    logger,
    db,
    bus,
    settings,
    workspaces,
    vfs,
    scanner,
    documents,
    i18n,
    windows,
    web,
    launcher,
    desktop,
    exitGuard
  }
}

/**
 * 桌面记录（设计 5.2–5.5）：按平台与 e2e 假模式选择依赖。
 * 假模式与 PCH_E2E_FAKE_LAUNCHER 相同，打包后的应用绝不启用（只在未打包时读取环境变量）。
 * 窗口枚举不可用（非 Windows、koffi 加载失败）时不监控，IPC 照常返回空结果
 */
function createDesktop(deps: {
  db: Database
  vfs: VfsService
  settings: SettingsService
  windows: WindowService
  logger: Logger
}): { desktop: DesktopService; exitGuard: ExitGuard } {
  const { db, vfs, settings, windows, logger } = deps
  const T = DESKTOP_TIMINGS
  const fake =
    !app.isPackaged && process.env.PCH_E2E_FAKE_DESKTOP === '1'
      ? createFakeDesktop(process.env, logger)
      : null
  const live = new LiveState({ removeAfterMs: T.removeAfterMs })
  const listWindows = fake ? fake.listWindows : loadListWindows()
  if (!listWindows) {
    logger.warn(
      `desktop: window enumeration unavailable, monitoring disabled: ${listWindowsLoadError() ?? process.platform}`
    )
  }
  const collectors: Collector[] = fake
    ? fake.collectors
    : [
        createExplorerCollector(runPowerShell, T.collectorTimeoutMs),
        createOfficeCollector(runPowerShell, T.collectorTimeoutMs),
        createVscodeCollector({ readFile: readTextFile, appData: app.getPath('appData') }),
        createEclipseCollector({
          readFile: readTextFile,
          commandLineOf: commandLineViaPowerShell(runPowerShell, T.collectorTimeoutMs)
        })
      ]
  const monitor = listWindows
    ? new DesktopMonitor({
        listWindows,
        collectors,
        live,
        timings: {
          pollMs: T.pollMs,
          debounceMs: T.debounceMs,
          debounceOverrides: T.debounceOverrides,
          fullRefreshMs: T.fullRefreshMs,
          collectorTimeoutMs: T.collectorTimeoutMs
        },
        now: Date.now,
        logger,
        onChange: () => windows.broadcast('desktop.changed', { scope: 'current' })
      })
    : null
  const restoreDeps = fake?.restoreDeps ?? {
    spawnDetached,
    runPowerShell,
    exists: existsViaVfs(vfs)
  }
  const desktop = new DesktopService({
    // 机器标识用主机名：数据库随漫游配置文件到别的机器时不列出、不提示那台机器的快照
    repo: new DesktopSnapshotRepo(db, hostname()),
    monitor,
    live,
    restore: (items, open) =>
      restoreItems(items, open, {
        ...restoreDeps,
        sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
        logger
      }),
    logonAt: fake ? fake.logonAt : getLogonTime,
    now: Date.now,
    emit: (e) => windows.broadcast('desktop.changed', e),
    autoSaveMs: T.autoSaveMs,
    keepAuto: T.keepAuto,
    keepLogons: T.keepLogons,
    sessionFreezeMs: T.sessionFreezeMs,
    logger
  })
  const exitGuard = new ExitGuard({
    enabled: () => desktop.enabled,
    askOnExit: () => settings.get('desktop.askOnExit'),
    setAskOnExit: (value) => settings.set({ 'desktop.askOnExit': value }),
    rendererAlive: () => windows.mainRendererAlive(),
    focusMain: () => windows.focusMain(),
    requestExit: () => windows.sendToMain('desktop.exitRequested', {}),
    notifyCancelled: () => windows.sendToMain('desktop.exitCancelled', {}),
    closeMain: () => windows.closeMain(),
    saveExit: (save, keys) => desktop.saveExit(save, keys),
    currentKeys: () => desktop.current().items.map((i) => i.key),
    now: Date.now,
    shownTimeoutMs: T.exitShownTimeoutMs,
    sessionFreezeMs: T.sessionFreezeMs,
    logger
  })
  return { desktop, exitGuard }
}
