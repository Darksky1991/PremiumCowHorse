import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { hostname } from 'node:os'
import { app, net, session, shell } from 'electron'
import type { i18n } from 'i18next'
import { parseSftpUri, resolveLanguage, type LocationKind } from '@pch/shared'
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
import { SftpProvider } from '../vfs/providers/sftp.provider'
import { RemoteAccess, remoteFolderRoots } from '../vfs/remote-access'
import { ConnectionPool } from '../modules/connection/connection-pool'
import { ConnectionRepo } from '../modules/connection/connection.repo'
import { ConnectionService } from '../modules/connection/connection.service'
import { createHostKeyGate, type HostKeyGate } from '../modules/connection/host-key-gate'
import { electronSecretBox } from '../modules/connection/secret-box'
import { sftpOverChannel } from '../modules/connection/sftp-bridge'
import { connectSsh } from '../modules/connection/ssh-session'
import { openIdentityChannel } from '../modules/connection/sudo-switch'
import { location } from '../vfs/location'
import { ScannerClient } from '../vfs/scanner-client'
import { createRemoteOp } from '../vfs/remote-op'
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
  /** 远程连接（M4） */
  connections: ConnectionService
  pool: ConnectionPool
  hostKeys: HostKeyGate
  /** sftp: URI 的访问范围（根由 bootstrap 的 wireScanner 随扫描配置一并更新） */
  remoteAccess: RemoteAccess
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
  const i18n = createMainI18n(resolveLanguage(settings.get('general.language'), app.getLocale()))
  const windows = new WindowService(paths, settings, rendererUrl, () => i18n.t('common.appName'))

  // 远程连接（设计 devDoc/2026-11-22-37 第 5.2、5.3 节）：连接池以 SftpSessionSource 注入 SftpProvider
  const connectionRepo = new ConnectionRepo(db)
  const secrets = electronSecretBox()
  const hostKeys = createHostKeyGate({
    describe: async (id) => {
      const rec = await connectionRepo.get(id)
      return rec && { name: rec.name, host: rec.host, port: rec.port }
    },
    // 只发给主窗口；没有主窗口（或渲染端已崩溃）→ false → 按拒绝处理
    send: (p) => {
      if (!windows.mainRendererAlive()) return false
      windows.sendToMain('connection.hostKeyPrompt', p)
      return true
    }
  })
  const pool = new ConnectionPool({
    repo: connectionRepo,
    secrets,
    connect: connectSsh,
    openIdentity: openIdentityChannel,
    bridge: sftpOverChannel,
    readKeyFile: (file) => readFile(file),
    hostKeys,
    settings: () => ({
      keepaliveSec: settings.get('remote.keepaliveSec'),
      idleDisconnectMin: settings.get('remote.idleDisconnectMin'),
      timeoutSec: settings.get('vfs.timeoutSec.remote')
    }),
    onStatus: (id, state) => bus.emit('connection.status', { id, state }),
    now: Date.now,
    setTimer: setTimeout,
    clearTimer: clearTimeout,
    log: logger
  })

  // 一次性调用（stat、条目添加的校验、降级模式的直接枚举）的超时按位置取 vfs.timeoutSec.*（总时长）
  const sftp = new SftpProvider(pool)
  const vfs = new VfsService([new LocalProvider(), sftp], {
    timeoutMs: (uri) => {
      let where: LocationKind = 'network'
      try {
        where = location(uri)
      } catch {
        // 无法判断位置（例如不规范的 file URI）：按较长的网络超时
      }
      return settings.get(`vfs.timeoutSec.${where}`) * 1000
    }
  })
  const workspaces = new WorkspaceService(db, vfs, bus, app.getPath('temp'), {
    identities: async (id) => (await connectionRepo.get(id))?.identities ?? null
  })
  const remoteAccess = new RemoteAccess()
  // 扫描进程随主进程启动；配置（根、设置）由 bootstrap 在启动与工作区 / 设置变化时下发。
  // 远程目录由扫描进程经 remoteOp 请主进程代读：访问范围检查 + SftpProvider（设计 4.1、5.6）
  const scanner = new ScannerClient({
    fork: () => forkScanner(logger),
    cacheFile: paths.indexDb,
    onChanged: (uri) => bus.emit('vfs.changed', { uri }),
    onReachability: (e) => bus.emit('vfs.reachability', e),
    log: logger,
    remoteOp: createRemoteOp({ access: remoteAccess, provider: sftp })
  })
  scanner.start()
  const connections = new ConnectionService({
    repo: connectionRepo,
    secrets,
    pool,
    emitChanged: () => bus.emit('connection.changed', {}),
    // 连接被重置（编辑 / 删除 / 重新连接 / 信任新密钥）：立即重新检查该连接的远程条目根
    onConnectionReset: (id) => {
      remoteRootsOf(workspaces, id)
        .then((roots) => {
          if (roots.length > 0) scanner.refresh(roots)
        })
        .catch((e: unknown) => logger.error(`[connection] refresh roots of ${id} failed`, e))
    },
    now: Date.now,
    timeoutMs: () => settings.get('vfs.timeoutSec.remote') * 1000
  })
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
    exitGuard,
    connections,
    pool,
    hostKeys,
    remoteAccess
  }
}

/** 所有工作区中指向该连接的远程 folder 条目根（已规范化） */
async function remoteRootsOf(
  workspaces: WorkspaceService,
  connectionId: string
): Promise<string[]> {
  const all = await workspaces.list()
  const entries = (await Promise.all(all.map((w) => workspaces.listEntries(w.id)))).flat()
  return remoteFolderRoots(entries).filter(
    (uri) => parseSftpUri(uri)?.connectionId === connectionId
  )
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
        onChange: () => {
          windows.broadcast('desktop.changed', { scope: 'current' })
          // 现场变化 → 尽快同步自动快照（desktop 在 monitor.start 之前已构造完成）
          desktop.liveChanged()
        }
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
    changeSaveDelayMs: T.changeSaveDelayMs,
    keepVisible: T.keepVisible,
    restoreRescanMs: T.restoreRescanMs,
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
    saveExit: (save, picks) => desktop.saveExit(save, picks),
    currentPicks: () => desktop.current().items.map((i) => ({ key: i.key })),
    now: Date.now,
    shownTimeoutMs: T.exitShownTimeoutMs,
    sessionFreezeMs: T.sessionFreezeMs,
    logger
  })
  return { desktop, exitGuard }
}
