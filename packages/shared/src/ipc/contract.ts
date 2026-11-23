import { z } from 'zod'
import type { AppErrorPayload } from '../errors/app-error'
import { SettingsPatch, type Settings } from '../settings/schema'
import {
  EntryAddInput,
  EntryMoveInput,
  EntrySetCacheStrategyInput,
  IndexSetTargetInput,
  EntryUpdateInput,
  WorkspaceCreateInput,
  WorkspaceReorderInput,
  WorkspaceUpdateInput
} from '../workspace/schema'
import type { DirectoryListing, FileStat } from '../vfs/types'
import {
  DOC_ENCODINGS,
  DOC_READ_LINES_MAX,
  type DocChangedEvent,
  type DocLineBlock,
  type DocProgressEvent,
  type DocumentInfo,
  type SniffInfo
} from '../doc/types'
import type { SearchResult } from '../search/types'
import type { OfflineShare, ReachabilityEvent } from '../scanner/types'
import type { Workspace, WorkspaceEntry, WorkspaceSummary } from '../workspace/types'
import { LAUNCH_MODES, type LaunchCapabilities } from '../launcher/types'
import type { WebNotice, WebShortcut, WebViewState } from '../web/types'
import { ConnectionSaveInput, ConnectionTrustHostKeyInput } from '../connection/schema'
import type {
  ConnectionDto,
  ConnectionState,
  ConnectionTestResult,
  HostKeyPrompt
} from '../connection/types'
import type { RecentItem } from '../recent/types'
import { IDENTITY_PATTERN } from '../vfs/sftp-uri'
import type {
  DesktopCurrent,
  DesktopRestoreResult,
  DesktopSnapshot,
  DesktopSnapshotSummary
} from '../desktop/types'

/** vfs.interest 的 visible / offscreen 与 vfs.refresh 的 uris 的上限（渲染端超过时截断） */
export const VFS_INTEREST_VISIBLE_MAX = 2000
export const VFS_INTEREST_OFFSCREEN_MAX = 5000
/** vfs.interest 的 tabs（标签中显示的目录）的上限 */
export const VFS_INTEREST_TABS_MAX = 8
export const VFS_REFRESH_MAX = 500

/**
 * desktop.save / desktop.exit 的项目 key 的长度上限：Explorer 的 key 由全部标签路径拼成，
 * 多标签、长路径（最长约 32_767 字符）时会超过 4096；放宽为 65_536（只是输入上限，不影响存储）
 */
export const DESKTOP_KEY_MAX = 65_536

/** Explorer 选中标签的下标（DesktopPick / DesktopRestorePick 的 tabs） */
const DesktopTabs = z.array(z.number().int().nonnegative()).max(500).optional()
const DesktopPickInput = z.strictObject({ key: z.string().max(DESKTOP_KEY_MAX), tabs: DesktopTabs })

/** 浏览器视图（web.*）的标签 id 与位置：DIP 整数，宿主自行取整（Electron 对小数隐式四舍五入，不依赖它） */
const WebTabId = z.string().min(1).max(200)
const WebBoundsInput = z.strictObject({
  x: z.number().int(),
  y: z.number().int(),
  width: z.number().int().min(0),
  height: z.number().int().min(0)
})

/** route<输出类型>()(输入 schema)：输入由 zod 运行时校验，输出只做类型约束 */
const route =
  <O>() =>
  <I extends z.ZodType>(input: I) => ({ input, output: undefined as unknown as O })

export interface AppInfo {
  name: string
  version: string
  electron: string
  chrome: string
  node: string
  platform: NodeJS.Platform
  arch: string
  /** 用户数据目录（只用于显示；打开用 system.openAppFolder） */
  userDataDir: string
  /** 日志目录（同上） */
  logsDir: string
}

/** 发起调用的那个窗口的状态（自绘窗口按钮据此切换「最大化 / 还原」图标） */
export interface WindowState {
  maximized: boolean
}

/**
 * 渲染端 → 主进程的全部通道。主进程注册时必须全部实现（漏写会编译失败），
 * 渲染端调用时自动获得输入输出类型。
 */
export const ipcContract = {
  'app.getInfo': route<AppInfo>()(z.void()),
  'settings.getAll': route<Settings>()(z.void()),
  'settings.set': route<void>()(SettingsPatch),
  /** 工作区；「当前工作区」= 最近一次 activate 的工作区 */
  'workspace.list': route<Workspace[]>()(z.void()),
  'workspace.active': route<Workspace>()(z.void()),
  'workspace.create': route<Workspace>()(WorkspaceCreateInput),
  'workspace.update': route<Workspace>()(WorkspaceUpdateInput),
  'workspace.delete': route<void>()(z.strictObject({ id: z.string().min(1) })),
  'workspace.activate': route<void>()(z.strictObject({ id: z.string().min(1) })),
  /** 选择器用的摘要（全部工作区，含已归档） */
  'workspace.summaries': route<WorkspaceSummary[]>()(z.void()),
  /** 完整顺序：必须恰好是全部未归档工作区的排列，否则 IPC_BAD_INPUT */
  'workspace.reorder': route<void>()(WorkspaceReorderInput),
  /** 工作区条目（group / folder / file） */
  'entry.list': route<WorkspaceEntry[]>()(z.strictObject({ workspaceId: z.string().min(1) })),
  'entry.add': route<WorkspaceEntry>()(EntryAddInput),
  'entry.update': route<WorkspaceEntry>()(EntryUpdateInput),
  'entry.remove': route<void>()(z.strictObject({ id: z.string().min(1) })),
  'entry.move': route<void>()(EntryMoveInput),
  'entry.setCacheStrategy': route<WorkspaceEntry>()(EntrySetCacheStrategyInput),
  'index.setTarget': route<void>()(IndexSetTargetInput),
  'index.list': route<string[]>()(z.strictObject({ workspaceId: z.string().min(1) })),
  /** 文件系统的一次性调用（经 VfsService 按 scheme 路由）；requestId 用于取消，同一 id 的新请求取代旧请求 */
  'vfs.stat': route<FileStat>()(z.strictObject({ uri: z.string().min(1) })),
  /**
   * 目录列表：经扫描进程（有缓存立即返回缓存并安排检查，没有则枚举后返回）；扫描进程不可用时
   * 由 VfsService 直接枚举（state 'fresh'）。requestId 只对直接枚举有效（vfs.cancel）
   */
  'vfs.list': route<DirectoryListing>()(
    z.strictObject({ uri: z.string().min(1), requestId: z.string().min(1).optional() })
  ),
  'vfs.cancel': route<void>()(z.strictObject({ requestId: z.string().min(1) })),
  /**
   * 本窗口的关注点、已展开目录（视口内 / 外）与标签中显示的目录（整体替换）；
   * 缓存内容变化经 vfs.changed 广播
   */
  'vfs.interest': route<void>()(
    z.strictObject({
      focus: z.string().min(1).nullable(),
      visible: z.array(z.string().min(1)).max(VFS_INTEREST_VISIBLE_MAX),
      offscreen: z.array(z.string().min(1)).max(VFS_INTEREST_OFFSCREEN_MAX),
      tabs: z.array(z.string().min(1)).max(VFS_INTEREST_TABS_MAX)
    })
  ),
  /** F5 / 刷新按钮 / 「重试」：立即检查这些目录（断开的共享也立即尝试一次） */
  'vfs.refresh': route<void>()(
    z.strictObject({ uris: z.array(z.string().min(1)).max(VFS_REFRESH_MAX) })
  ),
  /** 目录缓存（userData/cache/index.db）的占用与清空；界面随 M5 设置页 */
  /**
   * 当前断开的共享 / 卷（主进程随 vfs.reachability 维护）。渲染端订阅 vfs.reachability 时先查询一次，
   * 窗口启动、重新加载后不漏掉此前已断开的共享
   */
  'vfs.offlineShares': route<OfflineShare[]>()(z.strictObject({})),
  'vfs.cacheInfo': route<{ bytes: number }>()(z.strictObject({})),
  'vfs.clearCache': route<void>()(z.strictObject({})),
  /** 文本 / 二进制判断：读开头 8KB（开-读-关）。未被任何预览插件匹配的文件先 sniff 再选插件 */
  'vfs.sniff': route<SniffInfo>()(z.strictObject({ uri: z.string().min(1) })),
  /**
   * 文本文档（分页模型，doc/ 7.5 节）：文档归属调用方窗口（每窗口最多 16 个，超出时关闭最久未用的），
   * 窗口销毁时全部释放；docId 不存在或已关闭 → DOC_NOT_FOUND。
   * doc.open：stat + 判断编码 + 开始后台索引（进度经 doc.progress）。at 决定部分模式取开头还是末尾（默认开头）；
   * encoding 为手动指定的编码
   */
  'doc.open': route<DocumentInfo>()(
    z.strictObject({
      uri: z.string().min(1),
      encoding: DOC_ENCODINGS.optional(),
      at: z.enum(['start', 'end']).optional()
    })
  ),
  /** 第 start 行起的 count 行（窗口内行号；不超过已确定的行数）。行的语义见 DocLineBlock */
  'doc.readLines': route<DocLineBlock>()(
    z.strictObject({
      docId: z.string().min(1),
      start: z.number().int().min(0),
      count: z.number().int().min(1).max(DOC_READ_LINES_MAX)
    })
  ),
  /** 重新 stat：只增长 → 续扫（doc.changed appended）；截断 / 开头变化 → 重建（reset）；不存在 → missing */
  'doc.refresh': route<DocumentInfo>()(z.strictObject({ docId: z.string().min(1) })),
  /** 手动指定编码（null = 恢复自动判断）；切换到 / 离开 UTF-16 时重建索引 */
  'doc.setEncoding': route<DocumentInfo>()(
    z.strictObject({ docId: z.string().min(1), encoding: DOC_ENCODINGS.nullable() })
  ),
  /** 部分模式 → 全量：对整个文件建立索引（已是全量时不做任何事） */
  'doc.buildIndex': route<DocumentInfo>()(z.strictObject({ docId: z.string().min(1) })),
  'doc.close': route<void>()(z.strictObject({ docId: z.string().min(1) })),
  /**
   * 文件名搜索：只查缓存（不访问文件系统）。text 按空白分词（AND），含 * / ? 的词为通配；
   * 范围为该工作区的 folder 条目（固定的单个文件条目按名称匹配）。同一 requestId 的新查询取代旧查询，
   * 渲染端取消用 vfs.cancel。扫描进程不可用时以 INDEX_UNAVAILABLE 拒绝
   */
  'search.query': route<SearchResult>()(
    z.strictObject({
      workspaceId: z.string().min(1),
      text: z.string().max(500),
      kind: z.enum(['all', 'file', 'directory']),
      limit: z.number().int().min(1).max(1000).optional(),
      requestId: z.string().min(1)
    })
  ),
  /** 系统操作（均不修改文件）：在资源管理器中显示 / 用系统应用打开 / 写剪贴板 / 选择路径对话框 */
  'system.revealInOs': route<void>()(z.strictObject({ uri: z.string().min(1) })),
  /**
   * 用系统关联的应用打开（shell.openPath）。只由预览插件的宿主经用户点击调用，
   * 可执行类扩展名由渲染端先确认（设计 devDoc/2026-11-19-12 第 3.3 节）
   */
  'system.openPath': route<void>()(z.strictObject({ uri: z.string().min(1) })),
  /**
   * 在资源管理器中打开应用自己的目录（shell.openPath）：主进程按固定路径执行，不接受渲染端传路径
   * （关于页的「ログフォルダーを開く」「データフォルダーを開く」）
   */
  'system.openAppFolder': route<void>()(z.strictObject({ which: z.enum(['logs', 'userData']) })),
  'system.copyText': route<void>()(z.strictObject({ text: z.string().max(32768) })),
  /** 返回所选本地路径；用户取消时为空数组 */
  'system.selectPaths': route<string[]>()(
    z.strictObject({ kind: z.enum(['folder', 'file']), multiple: z.boolean() })
  ),
  /**
   * 浏览器视图（主进程 modules/web，doc 第 15 节）：每个（窗口, 标签）一个 WebContentsView，归属调用方窗口。
   * web.attach：不存在则创建，存在则复用（URL 相同不重新加载）；放到 bounds 并显示。uri 必须在 scopeRoot 之下
   * （否则 FS_INVALID_URI）。fragment（视图内链接带的 `?查询#锚点`，web.navigate 的 fragment）加载时拼到地址后
   * （是否重新加载只看不含它的地址）。每窗口最多 8 个视图，超出时销毁最久未显示的（显示中的除外）。
   * 其余通道对不存在的视图不做任何事（web.freeze 返回 `{ image: '', yielded: false }`；已在截图中时同样返回空图）
   */
  'web.attach': route<void>()(
    z.strictObject({
      tabId: WebTabId,
      uri: z.string().min(1),
      scopeRoot: z.string().min(1),
      view: z.enum(['page', 'markdown']),
      bounds: WebBoundsInput,
      fragment: z.string().max(8192).regex(/^[?#]/).optional()
    })
  ),
  /** 位置同步（高频） */
  'web.setBounds': route<void>()(z.strictObject({ tabId: WebTabId, bounds: WebBoundsInput })),
  /** 隐藏（插件卸载：切换标签 / 查看器）；视图与页面状态保留 */
  'web.hide': route<void>()(z.strictObject({ tabId: WebTabId })),
  /** 销毁（标签关闭 / 当前位置不再使用网页查看器） */
  'web.release': route<void>()(z.strictObject({ tabId: WebTabId })),
  /** 重新加载（地址栏刷新 / F5） */
  'web.reload': route<void>()(z.strictObject({ tabId: WebTabId })),
  /**
   * 截图替身：返回视图当前画面（data:image/png，物理像素）并隐藏视图；视图持有键盘焦点时交回应用界面
   * （yielded 为真）。视图不存在 / 已在截图中 → 空图
   */
  'web.freeze': route<{ image: string; yielded: boolean }>()(z.strictObject({ tabId: WebTabId })),
  /** 结束截图替身、恢复显示；refocus 为真时把焦点还给视图（渲染端判断用户没有在应用中操作） */
  'web.unfreeze': route<void>()(z.strictObject({ tabId: WebTabId, refocus: z.boolean() })),
  /** Office 等文件的打开方式检测（按扩展名缓存）/ 按方式启动 / 清缓存重新检测（doc 第 10 节）。均不修改文件 */
  'launcher.capabilities': route<LaunchCapabilities>()(z.strictObject({ uri: z.string().min(1) })),
  'launcher.open': route<void>()(
    z.strictObject({ uri: z.string().min(1), mode: z.enum(LAUNCH_MODES) })
  ),
  'launcher.redetect': route<void>()(z.void()),
  /**
   * 桌面记录（M3，主进程 modules/desktop）。快照只含本机的；id 不存在 → DESKTOP_SNAPSHOT_NOT_FOUND。
   * desktop.current：当前现场（开着的项目）与本轮无法读取的类别；非 Windows 为空
   */
  'desktop.list': route<DesktopSnapshotSummary[]>()(z.void()),
  'desktop.get': route<DesktopSnapshot>()(z.strictObject({ id: z.number().int().positive() })),
  'desktop.current': route<DesktopCurrent>()(z.void()),
  /** 手动快照：当前现场中选中的项目（Explorer 可只选部分标签）；返回快照 id */
  'desktop.save': route<number>()(
    z.strictObject({
      picks: z.array(DesktopPickInput).max(500),
      name: z.string().max(100).nullable()
    })
  ),
  'desktop.rename': route<void>()(
    z.strictObject({ id: z.number().int().positive(), name: z.string().max(100).nullable() })
  ),
  'desktop.delete': route<void>()(z.strictObject({ id: z.number().int().positive() })),
  /**
   * 按快照恢复：只传快照 id 与项目 id，程序路径与参数由主进程从数据库取出（不属于该快照的项目 id 忽略）。
   * 已开着的项目跳过；Explorer 可只恢复部分标签（tabs）。不删除快照（删除由用户确认后 desktop.clear）
   */
  'desktop.restore': route<DesktopRestoreResult>()(
    z.strictObject({
      snapshotId: z.number().int().positive(),
      picks: z
        .array(z.strictObject({ id: z.number().int().positive(), tabs: DesktopTabs }))
        .max(500)
    })
  ),
  /** 删除全部快照（含 exit-none；恢复后经用户确认调用），之后立即写一份本次登录的自动快照 */
  'desktop.clear': route<void>()(z.void()),
  /** 启动时的恢复候选（items 已滤掉开着的）；没有可提示的 → null。每次启动只返回一次 */
  'desktop.restorePrompt': route<DesktopSnapshot | null>()(z.void()),
  /**
   * 回应 desktop.exitRequested：save 为真时保存 picks 选中的项目，否则记为「不保存」；
   * dontAskAgain 时写设置 desktop.askOnExit = false。之后主进程关闭主窗口
   */
  'desktop.exit': route<void>()(
    z.strictObject({
      save: z.boolean(),
      picks: z.array(DesktopPickInput).max(500),
      dontAskAgain: z.boolean()
    })
  ),
  /** 回应 desktop.exitRequested：取消退出 */
  'desktop.cancelExit': route<void>()(z.void()),
  /** 渲染端已显示退出对话框（收到 desktop.exitRequested 后调用）；之后主进程不再超时 */
  'desktop.exitShown': route<void>()(z.void()),
  /**
   * 远程连接（M4，主进程 modules/connection）。按 connectionId 操作，不受条目范围（K17）限制；
   * id 不存在 → CONN_NOT_FOUND。返回的 ConnectionDto 不含机密（只有 hasSecret / hasSudoSecret）。
   * connection.save：无 id = 新建；secret / sudoSecret 省略 = 不变、空串 / null = 清除；
   * 机密无法加密保存 → CONN_SECRET_UNAVAILABLE。编辑只在对应的凭据有变化时解除认证锁定（登录：密码 / 主机 /
   * 端口 / 用户名 / 认证方式 / 私钥；sudo：sudo 密码，或未另设时的登录密码）；只改名称时不断开该连接
   */
  'connection.list': route<ConnectionDto[]>()(z.void()),
  'connection.save': route<ConnectionDto>()(ConnectionSaveInput),
  /** 断开并删除；引用它的条目保留 */
  'connection.delete': route<void>()(z.strictObject({ id: z.string().min(1) })),
  /** 测试连接：逐步结果（连接 / 主机密钥 / 认证 / SFTP / 各身份） */
  'connection.test': route<ConnectionTestResult>()(z.strictObject({ id: z.string().min(1) })),
  /** 「重新连接」：解除认证锁定并断开，之后的请求重新连接 */
  'connection.reconnect': route<void>()(z.strictObject({ id: z.string().min(1) })),
  /**
   * 「信任新的密钥」：保存用户看到的新主机密钥 key（没有出示的密钥 → CONN_NOT_FOUND；
   * 与服务器最新出示的密钥不一致 → CONN_HOST_KEY_CHANGED，不保存）
   */
  'connection.trustHostKey': route<void>()(ConnectionTrustHostKeyInput),
  /** 回答 connection.hostKeyPrompt；过期 / 未知的 promptId 不做任何事 */
  'connection.answerHostKey': route<void>()(
    z.strictObject({ promptId: z.string().min(1), accept: z.boolean() })
  ),
  /** 尚未回答的主机密钥询问（渲染端重新加载后先查询一次，再订阅 connection.hostKeyPrompt） */
  'connection.pendingHostKeyPrompts': route<HostKeyPrompt[]>()(z.void()),
  /** 主目录：登录用户为 realpath(.)（会连接）；切换身份为 / */
  'connection.home': route<string>()(
    z.strictObject({
      id: z.string().min(1),
      identity: z.string().regex(IDENTITY_PATTERN).nullable()
    })
  ),
  /** 最近使用（M5）：按工作区，openedAt 降序 */
  'recent.list': route<RecentItem[]>()(
    z.strictObject({ workspaceId: z.string().min(1), limit: z.number().int().min(1).max(100) })
  ),
  /** 记录一次明确的打开（同 URI 只更新时间；每工作区只保留最近 100 条） */
  'recent.record': route<void>()(
    z.strictObject({
      workspaceId: z.string().min(1),
      uri: z.string().min(1),
      kind: z.enum(['file', 'directory']),
      title: z.string().max(500)
    })
  ),
  /** 清除最近使用：省略 workspaceId = 全部工作区 */
  'recent.clear': route<void>()(z.strictObject({ workspaceId: z.string().min(1).optional() })),
  /** 自绘标题栏的窗口按钮：作用于发起调用的窗口 */
  'window.minimize': route<void>()(z.void()),
  'window.toggleMaximize': route<void>()(z.void()),
  'window.close': route<void>()(z.void()),
  'window.getState': route<WindowState>()(z.void()),
  /** 渲染端未捕获的错误写入主进程日志，便于用户反馈问题时提供 main.log */
  'log.write': route<void>()(
    z.object({
      level: z.enum(['error', 'warn', 'info']),
      message: z.string().max(10_000),
      stack: z.string().max(20_000).optional()
    })
  )
} as const

export function isIpcChannel(name: string): name is IpcChannel {
  return Object.hasOwn(ipcContract, name)
}

export type IpcContract = typeof ipcContract
export type IpcChannel = keyof IpcContract
export type IpcInput<C extends IpcChannel> = z.infer<IpcContract[C]['input']>
export type IpcOutput<C extends IpcChannel> = IpcContract[C]['output']

/** 主进程 → 渲染进程的广播事件 */
export interface IpcEvents {
  'settings.changed': Partial<Settings>
  /** 工作区或其条目发生变化（id 为工作区 id） */
  'workspace.changed': { id: string }
  /** 目录的缓存内容（列表或状态）有变化 */
  'vfs.changed': { uri: string }
  /** 共享（`\\host\share`，小写）或卷（`C:`）断开 / 恢复 */
  'vfs.reachability': ReachabilityEvent
  /** 只发给状态发生变化的那个窗口 */
  'window.stateChanged': WindowState
  /** 文档的索引进度（只发给文档所属的窗口） */
  'doc.progress': DocProgressEvent
  /** 文档对应的文件有变化（只发给文档所属的窗口） */
  'doc.changed': DocChangedEvent
  /** 浏览器视图的页面状态（以下 web.* 只发给视图所属的窗口） */
  'web.state': WebViewState
  /**
   * 视图内的链接指向范围内的资源：应用在该标签（newTab 时在新标签）打开 uri。
   * fragment：链接的 `?查询#锚点`（不进入标签的 uri；在该标签打开时交给下一次 web.attach），没有时为空字符串
   */
  'web.navigate': { tabId: string; uri: string; newTab: boolean; fragment: string }
  /** 视图内被阻止的动作（范围外 / 下载 / 不支持的协议） */
  'web.notice': { tabId: string; notice: WebNotice }
  /** 焦点在视图中时按下的应用快捷键（以及鼠标侧键 → Alt+←/→），由应用窗口执行 */
  'web.shortcut': { tabId: string } & WebShortcut
  /** 桌面记录有变化：current = 当前现场，snapshots = 快照列表（写入 / 改名 / 删除）。广播 */
  'desktop.changed': { scope: 'current' | 'snapshots' }
  /**
   * 用户关闭主窗口、需要询问是否保存（只发给主窗口；询问中再次关闭会重发）：渲染端显示对话框后立即调用
   * desktop.exitShown，再以 desktop.exit 或 desktop.cancelExit 回应。10 秒内没有 exitShown 按「全部保存并退出」
   * 处理；收到 exitShown 后无限等待。对话框已开着时收到重复请求，也必须再调一次 desktop.exitShown（重发会重新开始
   * 10 秒计时）。页面重新加载 / 渲染进程退出时询问作废
   */
  'desktop.exitRequested': Record<string, never>
  /** 主进程取消了挂起的询问（关机开始等），渲染端关闭退出对话框（只发给主窗口） */
  'desktop.exitCancelled': Record<string, never>
  /** 最近使用有变化（记录 / 清除）；workspaceId 为 null = 清除了全部。广播 */
  'recent.changed': { workspaceId: string | null }
  /** 连接列表有变化（保存 / 删除 / 信任密钥 / 重新连接 / 测试之后）。广播 */
  'connection.changed': Record<string, never>
  /** 连接状态变化（连接池）。广播 */
  'connection.status': { id: string; state: ConnectionState }
  /**
   * 首次连接时请求确认主机密钥（只发给主窗口；没有主窗口时按拒绝处理）。以 connection.answerHostKey 回答；
   * 5 分钟内未回答按拒绝处理
   */
  'connection.hostKeyPrompt': HostKeyPrompt
  /** 主机密钥询问已结束（回答 / 超时）：渲染端移除对应的确认框。只发给主窗口 */
  'connection.hostKeyPromptClosed': { promptId: string }
}
export type IpcEventName = keyof IpcEvents

/** Electron 跨进程抛出的 Error 会丢失错误码，因此统一包装成结果对象 */
export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: AppErrorPayload }

/** preload 通过 contextBridge 暴露给渲染端的 API（window.pch） */
export interface PchBridge {
  invoke(channel: string, input: unknown): Promise<unknown>
  on(event: string, listener: (payload: unknown) => void): () => void
  getPathForFile(file: File): string
  bootstrap: import('./bootstrap').BootstrapData | null
}
