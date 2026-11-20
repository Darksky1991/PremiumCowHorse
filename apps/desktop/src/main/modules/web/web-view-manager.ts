import {
  AppError,
  isUnderUri,
  normalizeRootUri,
  type IpcEvents,
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

/** Markdown 视图的查询参数（协议处理器见到它时返回查看脚本的外壳，Task 8） */
const MARKDOWN_QUERY = '?pch-view=markdown'

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
  url: string
  scopeId: string
  /** 逻辑上显示中（attach 之后、hide 之前；截图替身期间仍算显示中） */
  shown: boolean
  /** 截图替身中（视图本身隐藏） */
  frozen: boolean
  /** 最近一次显示的时刻（attach / hide 时更新的单调序号；LRU 用） */
  lastShown: number
  state: Omit<WebViewState, 'tabId'>
  destroyed: boolean
}

/**
 * 浏览器视图管理（设计 5.3.1）：以（窗口, 标签 id）为键，每个标签一个视图。
 * 插件卸载只隐藏（页面状态保留），标签关闭 / 不再使用网页查看器时 release 销毁；
 * 每窗口超过 WEB_VIEW_LIMIT 个时销毁最久未显示的（显示中的除外），该标签再显示时重新创建并加载。
 */
export class WebViewManager {
  private readonly windows = new Map<number, Map<string, Entry>>()
  private clock = 0

  constructor(
    private readonly deps: {
      createView: (events: ViewEvents) => ViewLike
      send: SendToWindow
      scopes: ScopeTable
      /** 外部链接交给系统（shell.openExternal） */
      openExternal: (url: string) => void
      logger: Logger
    }
  ) {}

  attach(owner: OwnerWindow, input: AttachInput): void {
    const root = normalizeRootUri(input.scopeRoot)
    if (!isUnderUri(input.uri, root)) {
      throw new AppError({ code: 'FS_INVALID_URI', detail: `${input.uri} is not under ${root}` })
    }
    const scopeId = this.deps.scopes.register(root)
    const url = toWebUrl(input.uri, root) + (input.view === 'markdown' ? MARKDOWN_QUERY : '')

    let entries = this.windows.get(owner.id)
    if (!entries) {
      entries = new Map()
      this.windows.set(owner.id, entries)
    }
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
    entry.lastShown = ++this.clock
    entry.scopeId = scopeId
    if (created || entry.url !== url) {
      entry.url = url
      this.load(entry)
    }
    if (created) this.evict(entries)
  }

  setBounds(ownerId: number, tabId: string, bounds: WebBounds): void {
    this.find(ownerId, tabId)?.view.setBounds(bounds)
  }

  hide(ownerId: number, tabId: string): void {
    const entry = this.find(ownerId, tabId)
    if (!entry) return
    this.yieldFocus(entry)
    entry.view.setVisible(false)
    if (entry.shown) entry.lastShown = ++this.clock
    entry.shown = false
    entry.frozen = false
  }

  release(ownerId: number, tabId: string): void {
    const entry = this.find(ownerId, tabId)
    if (!entry) return
    this.yieldFocus(entry)
    this.destroy(entry)
  }

  reload(ownerId: number, tabId: string): void {
    this.find(ownerId, tabId)?.view.webContents.reload()
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
    if (refocus) entry.view.webContents.focus()
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
      lastShown: 0,
      state: { title: '', loading: false, failed: null },
      destroyed: false
    }
    return ref.entry
  }

  private load(entry: Entry): void {
    entry.view.webContents.loadURL(entry.url).catch((e: unknown) => {
      // 加载失败经 did-fail-load / did-navigate 反映到 web.state；被新的导航中止（ERR_ABORTED）是正常的
      this.deps.logger.debug(`[web] loadURL ${entry.url}`, e)
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
          send(entry.ownerId, 'web.navigate', { tabId: entry.tabId, uri: decision.uri, newTab })
        } else if (decision.kind === 'external') {
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
      titleChanged: (title) => pushState({ title }),
      loadingChanged: (loading) => pushState(loading ? { loading, failed: null } : { loading }),
      loadFailed: (code) => pushState({ failed: code })
    }
  }
}
