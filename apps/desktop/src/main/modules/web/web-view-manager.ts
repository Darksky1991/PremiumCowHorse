import {
  AppError,
  isUnderUri,
  normalizeRootUri,
  type IpcEvents,
  type ThemeName,
  type WebBounds,
  type WebNotice,
  type WebViewKind,
  type WebViewState
} from '@pch/shared'
import type { Logger } from '../../infra/logger'
import { decideNavigation } from './navigation'
import { toWebUrl, type ScopeTable } from './scope'
import { matchShortcut, type KeyInput } from './shortcuts'

/** 每个窗口同时存在的视图上限（需求方决定；超出时销毁最久未显示的，显示中的除外） */
export const WEB_VIEW_LIMIT = 8

/**
 * 同一视图把外部链接交给系统的最小间隔：页面脚本（location.href = …）/ meta refresh 无需用户手势就能触发导航，
 * 不节流时可以连续拉起系统浏览器（实现记录 Q 清单）
 */
export const EXTERNAL_INTERVAL_MS = 2_000

/** Markdown 视图的查询参数（协议处理器见到它时返回查看脚本的外壳，Task 8） */
const MARKDOWN_QUERY = '?pch-view=markdown'

/**
 * 加载地址后拼接的片段：页面视图原样（`?查询#锚点`）；Markdown 视图的查询固定为 ?pch-view=markdown，只取 `#锚点`
 */
function fragmentFor(view: WebViewKind, fragment: string | undefined): string {
  if (!fragment) return ''
  if (view === 'page') return fragment
  const hash = fragment.indexOf('#')
  return hash === -1 ? '' : fragment.slice(hash)
}

/**
 * 视图的 webContents 发生的事件（由真实工厂 web-session.ts 从 Electron 事件转换后调用；
 * manager 只处理判定与发送，单元测试直接调用）
 */
export interface ViewEvents {
  /** 主框架导航（will-navigate / will-redirect：newTab=false）或新窗口请求（newTab=true）。视图自己一律不导航 */
  navigate(url: string, newTab: boolean): void
  /** 键盘按下 / 抬起（before-input-event）；返回 true = 应用快捷键，调用方阻止页面收到 */
  key(input: KeyInput): boolean
  /** 鼠标侧键抬起（后退 / 前进）；调用方已阻止页面收到侧键 */
  sideButton(direction: 'back' | 'forward'): void
  /** 用户在视图内按下鼠标（左 / 中 / 右键） */
  pointerDown(): void
  /** 视图的 webContents 拿到键盘焦点 */
  focused(): void
  titleChanged(title: string): void
  loadingChanged(loading: boolean): void
  /** 主框架加载失败（错误码见 WebViewState.failed） */
  loadFailed(code: string): void
}

/** 浏览器视图（真实实现包装 WebContentsView；测试用假对象） */
export interface ViewLike {
  readonly webContents: {
    readonly id: number
    loadURL(url: string): Promise<void>
    reload(): void
    executeJavaScript(code: string): Promise<unknown>
    capturePage(): Promise<{ toDataURL(): string }>
    /** 键盘焦点是否在本视图中 */
    isFocused(): boolean
    focus(): void
  }
  setBounds(bounds: WebBounds): void
  setVisible(visible: boolean): void
  /** 从所在窗口移除并关闭 webContents（结束渲染进程）；可重复调用 */
  destroy(): void
}

/** 视图所属的窗口 */
export interface OwnerWindow {
  /** 窗口渲染端的 webContents id（= IPC 的 senderId；事件按它发送） */
  readonly id: number
  /** 把视图加入窗口内容区的最上层（已在其中时移到最上层） */
  add(view: ViewLike): void
  /** 把键盘焦点交回窗口的渲染端（应用界面） */
  focus(): void
}

export interface AttachInput {
  tabId: string
  uri: string
  scopeRoot: string
  view: WebViewKind
  bounds: WebBounds
  /** 视图内链接带的 `?查询#锚点`（加载时拼到地址后） */
  fragment?: string
}

/** 只发给一个窗口（WindowService.sendTo） */
export type SendToWindow = <E extends 'web.state' | 'web.navigate' | 'web.notice' | 'web.shortcut'>(
  ownerId: number,
  event: E,
  payload: IpcEvents[E]
) => void

interface Entry {
  readonly tabId: string
  readonly ownerId: number
  /** 所属窗口（最近一次 attach 时的；焦点交回用） */
  owner: OwnerWindow
  readonly view: ViewLike
  /** attach 的地址（不含 fragment；是否重新加载按它判断） */
  url: string
  scopeId: string
  /** 逻辑上显示中（attach 之后、hide 之前；截图替身期间仍算显示中） */
  shown: boolean
  /** 截图替身中（视图本身隐藏） */
  frozen: boolean
  /**
   * 不让视图自己拿走焦点：attach 时视图没有焦点（用户在应用界面中操作，例如资源树的 ↑↓）即为真；
   * 焦点在页面中导航（见 WebViewManager.handoffs）的 attach、用户在视图内按下鼠标、应用把焦点还给视图（unfreeze）时为假
   */
  guardFocus: boolean
  /** 最近一次显示的时刻（attach / hide 时更新的单调序号；LRU 用） */
  lastShown: number
  state: Omit<WebViewState, 'tabId'>
  destroyed: boolean
  /** 最近一次把外部链接交给系统的时刻（节流用；没有时为 -Infinity） */
  lastExternal: number
}

/**
 * 浏览器视图管理（设计 5.3.1）：以（窗口, 标签 id）为键，每个标签一个视图。
 * 插件卸载只隐藏（页面状态保留），标签关闭 / 不再使用网页查看器时 release 销毁；
 * 每窗口超过 WEB_VIEW_LIMIT 个时销毁最久未显示的（显示中的除外），该标签再显示时重新创建并加载。
 */
export class WebViewManager {
  private readonly windows = new Map<number, Map<string, Entry>>()
  /**
   * 焦点在页面中导航的交接（窗口 id → 标签 id）：hide / release 时该标签的视图持有键盘焦点（交回了应用界面）即记下。
   * 用户在页面中点链接 / 按 Alt+←→ 时，渲染端先 hide（或查看器不同时 release）再 attach 新页面；
   * 同一标签紧接着的 attach 取走它，把焦点给视图（复用的或新建的）。下一次 attach（任一标签）、
   * 用户在应用界面中按键 / 按下鼠标（appInput）、窗口的视图全部销毁时作废——焦点原本在应用界面时维持 guardFocus 的规则
   */
  private readonly handoffs = new Map<number, string>()
  private clock = 0

  constructor(
    private readonly deps: {
      createView: (events: ViewEvents) => ViewLike
      send: SendToWindow
      scopes: ScopeTable
      /** 外部链接交给系统（shell.openExternal） */
      openExternal: (url: string) => void
      logger: Logger
      /** 当前时刻（毫秒；外部链接节流用，测试注入） */
      now?: () => number
    }
  ) {}

  attach(owner: OwnerWindow, input: AttachInput): void {
    const root = normalizeRootUri(input.scopeRoot)
    if (!isUnderUri(input.uri, root)) {
      throw new AppError({ code: 'FS_INVALID_URI', detail: `${input.uri} is not under ${root}` })
    }
    const scopeId = this.deps.scopes.register(root)
    const url = toWebUrl(input.uri, root) + (input.view === 'markdown' ? MARKDOWN_QUERY : '')
    const loadUrl = url + fragmentFor(input.view, input.fragment)

    let entries = this.windows.get(owner.id)
    if (!entries) {
      entries = new Map()
      this.windows.set(owner.id, entries)
    }
    // 只给紧接着的 attach（任一标签）一次机会
    const handoff = this.handoffs.get(owner.id) === input.tabId
    this.handoffs.delete(owner.id)
    let entry = entries.get(input.tabId)
    const created = !entry
    if (!entry) {
      entry = this.create(owner, input.tabId, url, scopeId)
      entries.set(input.tabId, entry)
    }
    entry.owner = owner
    owner.add(entry.view)
    entry.view.setBounds(input.bounds)
    entry.view.setVisible(true)
    entry.shown = true
    entry.frozen = false
    entry.guardFocus = !handoff && !this.hasFocus(entry)
    if (handoff) this.giveFocus(entry)
    entry.lastShown = ++this.clock
    entry.scopeId = scopeId
    // 只换片段（同一页面）不重新加载：页面内的锚点跳转由页面自己处理，不经 web.navigate
    if (created || entry.url !== url) {
      entry.url = url
      this.load(entry, loadUrl)
    }
    if (created) this.evict(entries)
  }

  setBounds(ownerId: number, tabId: string, bounds: WebBounds): void {
    this.find(ownerId, tabId)?.view.setBounds(bounds)
  }

  hide(ownerId: number, tabId: string): void {
    const entry = this.find(ownerId, tabId)
    if (!entry) return
    if (this.yieldFocus(entry)) this.handoffs.set(ownerId, tabId)
    entry.view.setVisible(false)
    if (entry.shown) entry.lastShown = ++this.clock
    entry.shown = false
    entry.frozen = false
  }

  release(ownerId: number, tabId: string): void {
    const entry = this.find(ownerId, tabId)
    if (!entry) return
    if (this.yieldFocus(entry)) this.handoffs.set(ownerId, tabId)
    this.destroy(entry)
  }

  /**
   * 用户在应用界面中按下键盘 / 鼠标（窗口渲染端的 before-input-event / before-mouse-event；web-session.ts 的
   * bindWebViewOwner）：焦点已由用户移到应用中，作废焦点交接（例如页面中 Alt+← 回到文本文件后，在应用中按 Alt+→
   * 回到网页：焦点留在应用）
   */
  appInput(ownerId: number): void {
    this.handoffs.delete(ownerId)
  }

  reload(ownerId: number, tabId: string): void {
    this.find(ownerId, tabId)?.view.webContents.reload()
  }

  /**
   * 应用的配色主题变化：已打开的 Markdown 视图就地切换 `<html data-theme>`（不重新加载，滚动位置与已渲染的内容保留）；
   * 查看脚本监视该属性并按新主题重新渲染 mermaid。脚本由主进程注入（executeJavaScript 不受页面 CSP 约束），
   * 主题名来自枚举，不含需要转义的字符
   */
  setMarkdownTheme(theme: ThemeName): void {
    const code =
      theme === 'default'
        ? 'delete document.documentElement.dataset.theme'
        : `document.documentElement.dataset.theme = '${theme}'`
    for (const entries of this.windows.values()) {
      for (const entry of entries.values()) {
        // 注入仅限应用自己生成的 Markdown 外壳页（?pch-view=markdown）与固定脚本；其他网页视图一律不注入
        if (entry.destroyed || !entry.url.endsWith(MARKDOWN_QUERY)) continue
        entry.view.webContents.executeJavaScript(code).catch((e: unknown) => {
          this.deps.logger.debug(`[web] cannot apply the theme to tab ${entry.tabId}`, e)
        })
      }
    }
  }

  /**
   * 截图替身：返回当前画面（data:image/png；物理像素）并隐藏视图。视图不存在 / 已在截图中 → 空图。
   * 视图持有键盘焦点时交回应用界面（yielded 为真）：隐藏的视图拿不住焦点（实测 setVisible(false) 后
   * 视图与应用的 webContents.isFocused() 都为假，按键无处可去，应用快捷键也不生效）
   */
  async freeze(ownerId: number, tabId: string): Promise<{ image: string; yielded: boolean }> {
    const entry = this.find(ownerId, tabId)
    if (!entry || entry.frozen) return { image: '', yielded: false }
    const image = (await entry.view.webContents.capturePage()).toDataURL()
    let yielded = false
    // 截图期间被隐藏 / 销毁：不改变它的状态
    if (!entry.destroyed && entry.shown) {
      yielded = this.yieldFocus(entry)
      entry.view.setVisible(false)
      entry.frozen = true
    }
    return { image, yielded }
  }

  /**
   * 结束截图替身。refocus：把焦点还给视图（渲染端判断：截图时交回了焦点，且期间用户没有在应用中操作）
   */
  unfreeze(ownerId: number, tabId: string, refocus: boolean): void {
    const entry = this.find(ownerId, tabId)
    if (!entry || !entry.frozen) return
    entry.frozen = false
    if (!entry.shown) return
    entry.view.setVisible(true)
    if (refocus) {
      entry.guardFocus = false
      entry.view.webContents.focus()
    }
  }

  /** 会话事件（下载）→ 按 webContents id 找到所属视图后发提示 */
  notifyContents(webContentsId: number, notice: WebNotice): void {
    for (const entries of this.windows.values()) {
      for (const entry of entries.values()) {
        if (entry.view.webContents.id === webContentsId) {
          this.deps.send(entry.ownerId, 'web.notice', { tabId: entry.tabId, notice })
          return
        }
      }
    }
  }

  /** 窗口关闭 / 渲染端重新加载或崩溃：销毁该窗口的全部视图 */
  disposeWindow(ownerId: number): void {
    this.handoffs.delete(ownerId)
    const entries = this.windows.get(ownerId)
    if (!entries) return
    for (const entry of [...entries.values()]) this.destroy(entry)
    this.windows.delete(ownerId)
  }

  dispose(): void {
    for (const ownerId of [...this.windows.keys()]) this.disposeWindow(ownerId)
  }

  /**
   * 视图持有键盘焦点时交回所属窗口的应用界面：隐藏 / 销毁的视图若仍持有焦点，按键会落进看不见的页面
   * （或无处可去），应用的快捷键（Alt+← / Alt+→ / F5…）在用户点击应用之前都不生效（实测）。返回是否交回了焦点
   */
  private yieldFocus(entry: Entry): boolean {
    try {
      if (!entry.view.webContents.isFocused()) return false
      entry.owner.focus()
      return true
    } catch (e) {
      this.deps.logger.warn(`[web] cannot move the focus from the view of tab ${entry.tabId}`, e)
      return false
    }
  }

  /** 把键盘焦点给视图（焦点在页面中导航时） */
  private giveFocus(entry: Entry): void {
    try {
      entry.view.webContents.focus()
    } catch (e) {
      this.deps.logger.warn(`[web] cannot focus the view of tab ${entry.tabId}`, e)
    }
  }

  private hasFocus(entry: Entry): boolean {
    try {
      return entry.view.webContents.isFocused()
    } catch {
      return false
    }
  }

  private find(ownerId: number, tabId: string): Entry | undefined {
    return this.windows.get(ownerId)?.get(tabId)
  }

  private create(owner: OwnerWindow, tabId: string, url: string, scopeId: string): Entry {
    // 事件在视图创建之后才会发生：闭包读取下面填入的 entry
    const ref: { entry?: Entry } = {}
    const view = this.deps.createView(this.eventsFor(() => ref.entry))
    ref.entry = {
      tabId,
      ownerId: owner.id,
      owner,
      view,
      url,
      scopeId,
      shown: false,
      frozen: false,
      guardFocus: true,
      lastShown: 0,
      state: { title: '', loading: false, failed: null },
      destroyed: false,
      lastExternal: -Infinity
    }
    return ref.entry
  }

  private load(entry: Entry, url: string): void {
    entry.view.webContents.loadURL(url).catch((e: unknown) => {
      // 加载失败经 did-fail-load / did-navigate 反映到 web.state；被新的导航中止（ERR_ABORTED）是正常的
      this.deps.logger.debug(`[web] loadURL ${url}`, e)
    })
  }

  /** 新建视图后超出上限：销毁未显示者中最久未显示的那个（全部显示中则不销毁） */
  private evict(entries: Map<string, Entry>): void {
    if (entries.size <= WEB_VIEW_LIMIT) return
    let oldest: Entry | null = null
    for (const entry of entries.values()) {
      if (entry.shown) continue
      if (!oldest || entry.lastShown < oldest.lastShown) oldest = entry
    }
    if (oldest) this.destroy(oldest)
  }

  private destroy(entry: Entry): void {
    entry.destroyed = true
    this.windows.get(entry.ownerId)?.delete(entry.tabId)
    try {
      entry.view.destroy()
    } catch (e) {
      this.deps.logger.warn(`[web] cannot destroy the view of tab ${entry.tabId}`, e)
    }
  }

  /** 视图事件 → 判定与发送。get() 返回 undefined 或已销毁的视图时一律忽略 */
  private eventsFor(get: () => Entry | undefined): ViewEvents {
    const { send, scopes, openExternal } = this.deps
    const live = (): Entry | null => {
      const entry = get()
      return entry && !entry.destroyed ? entry : null
    }
    const pushState = (patch: Partial<Entry['state']>): void => {
      const entry = live()
      if (!entry) return
      entry.state = { ...entry.state, ...patch }
      send(entry.ownerId, 'web.state', { tabId: entry.tabId, ...entry.state })
    }

    return {
      navigate: (url, newTab) => {
        const entry = live()
        if (!entry) return
        const decision = decideNavigation(url, { scopeId: entry.scopeId, scopes, newTab })
        if (decision.kind === 'app') {
          send(entry.ownerId, 'web.navigate', {
            tabId: entry.tabId,
            uri: decision.uri,
            newTab,
            fragment: decision.fragment
          })
        } else if (decision.kind === 'external') {
          const now = (this.deps.now ?? Date.now)()
          if (now - entry.lastExternal < EXTERNAL_INTERVAL_MS) {
            this.deps.logger.warn(`[web] dropped external navigation (throttled): ${decision.url}`)
            return
          }
          entry.lastExternal = now
          openExternal(decision.url)
        } else {
          this.deps.logger.info(`[web] blocked navigation (${decision.notice}): ${url}`)
          send(entry.ownerId, 'web.notice', { tabId: entry.tabId, notice: decision.notice })
        }
      },
      key: (input) => {
        const entry = live()
        if (!entry) return false
        const match = matchShortcut(input)
        if (!match) return false
        send(entry.ownerId, 'web.shortcut', { tabId: entry.tabId, ...match })
        return true
      },
      sideButton: (direction) => {
        const entry = live()
        if (!entry) return
        send(entry.ownerId, 'web.shortcut', {
          tabId: entry.tabId,
          key: direction === 'back' ? 'ArrowLeft' : 'ArrowRight',
          ctrl: false,
          shift: false,
          alt: true
        })
      },
      pointerDown: () => {
        const entry = live()
        if (!entry) return
        entry.guardFocus = false
        // 焦点事件可能先于鼠标事件到达并已被交回应用界面：按用户的意图把焦点给视图
        if (!this.hasFocus(entry)) entry.view.webContents.focus()
      },
      focused: () => {
        const entry = live()
        if (!entry || !entry.shown || !entry.guardFocus) return
        // 视图加载时会拿走键盘焦点（实测：新建视图 / loadURL），用户的方向键随之进入页面。
        // 用户没有点击视图时交回应用界面
        if (this.yieldFocus(entry)) {
          this.deps.logger.debug(
            `[web] gave the focus back to the app from the view of tab ${entry.tabId}`
          )
        }
      },
      titleChanged: (title) => pushState({ title }),
      loadingChanged: (loading) => pushState(loading ? { loading, failed: null } : { loading }),
      loadFailed: (code) => pushState({ failed: code })
    }
  }
}
