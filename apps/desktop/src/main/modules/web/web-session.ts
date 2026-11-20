// 浏览器视图与 Electron 的接线：专用会话的配置、WebContentsView 的创建与事件转换、所属窗口的解析。
// 判定与发送都在 web-view-manager.ts / navigation.ts（单元测试覆盖）；这里只做 Electron API 的薄转换。
import { BrowserWindow, WebContentsView, webContents, type Session } from 'electron'
import { AppError, type WebBounds } from '@pch/shared'
import type { Logger } from '../../infra/logger'
import { WEB_SCHEME } from './scope'
import { guardInitiator } from './web-protocol'
import type { OwnerWindow, ViewEvents, ViewLike } from './web-view-manager'

/** 浏览器视图的会话分区（持久化：原型的 localStorage / IndexedDB 在重启后保留，按范围编号隔离） */
export const WEB_PARTITION = 'persist:pch-web'

/**
 * 页面可以得到的权限：只有剪贴板写入（navigator.clipboard.writeText，原型的「复制」按钮；Chromium 要求用户手势）。
 * 实测：拒绝时 writeText 以 NotAllowedError 失败，document.execCommand('copy') 不经权限仍可用
 */
const ALLOWED_PERMISSIONS = new Set(['clipboard-sanitized-write'])

/**
 * 配置浏览器视图的会话（设计 5.3.2 / 5.3.3）：
 * - `pch-web` 协议处理器（外包发起方检查）；`pch-asset` 在 Task 8 注册
 * - 权限：除剪贴板写入外一律拒绝（请求与检查）
 * - 下载一律取消，并通知发起下载的视图（web.notice download）
 */
export function configureWebSession(
  ses: Session,
  deps: {
    handler: (request: Request) => Promise<Response>
    onDownload: (webContentsId: number) => void
    logger: Logger
  }
): void {
  ses.protocol.handle(WEB_SCHEME, guardInitiator(deps.handler))
  ses.setPermissionRequestHandler((_wc, permission, callback) => {
    const granted = ALLOWED_PERMISSIONS.has(permission)
    if (!granted) deps.logger.warn(`[web] denied permission: ${permission}`)
    callback(granted)
  })
  ses.setPermissionCheckHandler((_wc, permission) => ALLOWED_PERMISSIONS.has(permission))
  ses.on('will-download', (event, item, contents) => {
    event.preventDefault()
    deps.logger.info(`[web] download cancelled: ${item.getURL()}`)
    deps.onDownload(contents.id)
  })
}

/** WebContentsView 的包装：记住所在窗口，destroy 时移除并关闭 webContents */
class ElectronWebView implements ViewLike {
  readonly native: WebContentsView
  private parent: BrowserWindow | null = null

  constructor(native: WebContentsView) {
    this.native = native
  }

  get webContents(): Electron.WebContents {
    return this.native.webContents
  }

  setBounds(bounds: WebBounds): void {
    this.native.setBounds(bounds)
  }

  setVisible(visible: boolean): void {
    this.native.setVisible(visible)
  }

  mountIn(win: BrowserWindow): void {
    if (this.parent && this.parent !== win && !this.parent.isDestroyed()) {
      this.parent.contentView.removeChildView(this.native)
    }
    // 已在其中时 addChildView 把它移到最上层
    win.contentView.addChildView(this.native)
    this.parent = win
  }

  destroy(): void {
    if (this.parent && !this.parent.isDestroyed())
      this.parent.contentView.removeChildView(this.native)
    this.parent = null
    const contents = this.native.webContents
    if (!contents.isDestroyed()) contents.close()
  }
}

/**
 * 创建视图（Global Constraints 的 webPreferences：沙箱、隔离、无 preload、禁用 DevTools）并把 webContents 的事件
 * 转为 ViewEvents。应用窗口的全局导航策略（windows/security.ts）按会话跳过这些 webContents。
 */
export function createWebContentsView(ses: Session, events: ViewEvents): ViewLike {
  const native = new WebContentsView({
    webPreferences: {
      session: ses,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      devTools: false,
      spellcheck: false
    }
  })
  const wc = native.webContents

  // 导航（设计 5.3.6）：主框架的导航 / 重定向与新窗口请求一律不在视图内进行，交给判定；子框架不拦截
  wc.on('will-navigate', (details) => {
    if (!details.isMainFrame) return
    details.preventDefault()
    events.navigate(details.url, false)
  })
  wc.on('will-redirect', (details) => {
    if (!details.isMainFrame) return
    details.preventDefault()
    events.navigate(details.url, false)
  })
  wc.setWindowOpenHandler(({ url }) => {
    events.navigate(url, true)
    return { action: 'deny' }
  })

  // 键盘与鼠标侧键（设计 5.3.8）：应用快捷键不交给页面；侧键（Electron 报告为 back / forward）整组阻止，
  // 抬起时转为应用的后退 / 前进
  wc.on('before-input-event', (event, input) => {
    if (events.key(input)) event.preventDefault()
  })
  wc.on('before-mouse-event', (event, mouse) => {
    // electron.d.ts 的 button 类型只列 left / middle / right；Electron 源码（blink_converter.cc）对侧键输出 back / forward
    const button: string | undefined = mouse.button
    if (button !== 'back' && button !== 'forward') return
    event.preventDefault()
    if (mouse.type === 'mouseUp') events.sideButton(button)
  })

  // 页面状态（设计 5.3.5）
  wc.on('page-title-updated', (_event, title) => events.titleChanged(title))
  wc.on('did-start-loading', () => events.loadingChanged(true))
  wc.on('did-stop-loading', () => events.loadingChanged(false))
  wc.on('did-fail-load', (_event, code, description, _url, isMainFrame) => {
    // -3 ERR_ABORTED：被新的导航取代（例如加载中再次 attach 另一个 URL），不是失败
    if (!isMainFrame || code === -3) return
    events.loadFailed(description || String(code))
  })
  wc.on('did-navigate', (_event, _url, httpResponseCode) => {
    // 视图的历史只保留当前文档：标签的后退 / 前进由应用管理，页面的 history.back() 与任何历史导航都无处可去
    wc.navigationHistory.clear()
    // 协议处理器的 4xx / 5xx（空响应体）不触发 did-fail-load，Chromium 只显示空白页（实测）
    if (httpResponseCode >= 400) events.loadFailed(`HTTP_${httpResponseCode}`)
  })
  wc.on('render-process-gone', (_event, details) => events.loadFailed(`RENDERER_${details.reason}`))

  return new ElectronWebView(native)
}

/** IPC 调用方（senderId = 渲染端 webContents id）所在的窗口 */
export function ownerWindowOf(senderId: number): OwnerWindow {
  const contents = webContents.fromId(senderId)
  const win = contents && BrowserWindow.fromWebContents(contents)
  if (!win || win.isDestroyed()) {
    throw new AppError({ code: 'UNKNOWN', detail: 'sender window not found' })
  }
  return {
    id: senderId,
    add: (view) => {
      if (view instanceof ElectronWebView) view.mountIn(win)
    }
  }
}

/**
 * 视图归属窗口的生命周期（owner = 窗口渲染端的 webContents id）：
 * - 主框架提交了新文档（重新加载 / 导航；did-navigate）、渲染进程崩溃：销毁该窗口的全部视图（新页面不认识旧标签；
 *   否则显示中的视图会盖在重新加载后的界面上）。不用 did-start-navigation：被 will-navigate 阻止的导航
 *   （应用窗口里点外部链接）也会先发出它（实测），会误销毁全部视图
 * - webContents 销毁（窗口关闭）：全部销毁
 */
export function bindWebViewOwner(
  contents: Pick<Electron.WebContents, 'id' | 'on' | 'once'>,
  manager: { disposeWindow(ownerId: number): void }
): void {
  const id = contents.id
  contents.on('did-navigate', () => manager.disposeWindow(id))
  contents.on('render-process-gone', () => manager.disposeWindow(id))
  contents.once('destroyed', () => manager.disposeWindow(id))
}
