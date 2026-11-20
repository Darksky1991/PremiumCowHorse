import type { PreviewWebApi, WebPageState } from '@pch/plugin-sdk'
import { normalizeRootUri, type ErrorCode, type WebBounds, type WebViewState } from '@pch/shared'
import type { Invoke } from '@renderer/data/vfs'
import type { WebEvents } from '@renderer/data/web'

/**
 * 窗口级的浏览器视图登记（每个渲染端一个，preview-container 中创建）：
 * - 按标签串行执行 web.* 调用：web.freeze 要等 capturePage，期间到达的 web.unfreeze 若先执行，
 *   主进程会在截图完成后把视图隐藏而再也不显示；attach / hide / release 也必须保持顺序。
 * - 各标签视图的最近状态（attach 复用已有视图且 URL 相同时主进程不再发 web.state，插件重新挂载时由此回放）。
 * - 主进程中存在视图的标签：标签关闭（含未激活、没有挂载插件的标签）时 web.release。
 */
export interface WebViews {
  run: (tabId: string, task: () => Promise<unknown>) => void
  state: (tabId: string) => WebViewState | undefined
  /** 该标签在主进程中有视图（attach 之后） */
  track: (tabId: string) => void
  /** 销毁该标签的视图（排在该标签已发出的调用之后），忘记其状态 */
  release: (tabId: string) => void
}

export interface WebViewsDeps {
  invoke: Invoke
  events: Pick<WebEvents, 'onState'>
  /** 标签集合变化时回调（tabs-store 的订阅）；返回取消订阅函数 */
  onTabsChange: (listener: () => void) => () => void
  /** 标签是否仍存在（任一工作区） */
  tabExists: (tabId: string) => boolean
  /** web.* 调用失败（只记录：视图的失败对用户表现为页面状态） */
  onError: (error: unknown) => void
}

export function createWebViews(deps: WebViewsDeps): WebViews {
  const queues = new Map<string, Promise<void>>()
  const states = new Map<string, WebViewState>()
  const tracked = new Set<string>()

  const run = (tabId: string, task: () => Promise<unknown>): void => {
    const next = (queues.get(tabId) ?? Promise.resolve()).then(task).then(
      () => undefined,
      (e: unknown) => deps.onError(e)
    )
    queues.set(tabId, next)
    void next.then(() => {
      if (queues.get(tabId) === next) queues.delete(tabId)
    })
  }
  const release = (tabId: string): void => {
    tracked.delete(tabId)
    states.delete(tabId)
    run(tabId, () => deps.invoke('web.release', { tabId }))
  }
  // 窗口生命周期内一直订阅（渲染端重新加载时主进程销毁全部视图，登记随页面一起消失）
  deps.events.onState((state) => states.set(state.tabId, state))
  deps.onTabsChange(() => {
    for (const tabId of [...tracked]) if (!deps.tabExists(tabId)) release(tabId)
  })
  return { run, state: (tabId) => states.get(tabId), track: (tabId) => tracked.add(tabId), release }
}

/** 宿主用到的浏览器能力（单元测试注入假实现） */
export interface WebHostEnv {
  /** 元素大小变化（ResizeObserver）；返回停止函数 */
  observeResize: (element: HTMLElement, onResize: () => void) => () => void
  /** 窗口大小变化；返回停止函数 */
  onWindowResize: (onResize: () => void) => () => void
  /** 下一帧执行（requestAnimationFrame）；返回取消函数 */
  requestFrame: (callback: () => void) => () => void
  /** 在 window 上派发 keydown（复用应用现有的快捷键处理） */
  dispatchKey: (init: KeyboardEventInit) => void
}

const browserEnv: WebHostEnv = {
  observeResize: (element, onResize) => {
    const observer = new ResizeObserver(() => onResize())
    observer.observe(element)
    return () => observer.disconnect()
  },
  onWindowResize: (onResize) => {
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  },
  requestFrame: (callback) => {
    const id = requestAnimationFrame(() => callback())
    return () => cancelAnimationFrame(id)
  },
  dispatchKey: (init) => {
    window.dispatchEvent(new KeyboardEvent('keydown', init))
  }
}

/** 标签的当前位置（tabs-store）：卸载时据此决定只隐藏还是销毁视图 */
export interface WebTabLocation {
  uri: string
  viewer: string | null
}

/** 取自预览宿主（PreviewHost）的能力：宿主随主题、条目等变化重建，经 WebHost.setLinks 换成最新的 */
export interface WebHostLinks {
  /** 工作区 folder 条目的根（PreviewHost.fs.rootOf） */
  rootOf: (uri: string) => string | null
  /** 视图内的链接（PreviewHost.tabs：宿主 stat 后按查看器规则显示） */
  tabs: { open: (uri: string) => void; navigate: (uri: string) => void }
  /** openExternal 失败（提示用户） */
  onError: (error: unknown) => void
}

export interface WebHostDeps extends WebHostLinks {
  tabId: string
  views: WebViews
  invoke: Invoke
  events: WebEvents
  /** 本标签的刷新请求（地址栏刷新 / F5）；返回取消订阅函数 */
  onRefresh: (listener: () => void) => () => void
  /** 本标签的当前位置；标签已关闭时为 null */
  location: () => WebTabLocation | null
  /** 收起显示中的全部 toast 并收纳（messages-store 的 stashVisible） */
  stashToasts: () => void
  env?: Partial<WebHostEnv>
}

export interface WebHost {
  /** 交给插件的 PreviewHost.web */
  api: PreviewWebApi
  /**
   * 视图被应用界面遮挡的情况（overlay：打开中的弹出层；toasts：显示中的 toast）。任一为真时视图换成截图：
   * web.freeze → 占位元素背景 = 截图（主进程同时隐藏视图）；都为假时清除背景、web.unfreeze
   */
  setCovered: (covered: { overlay: boolean; toasts: boolean }) => void
  /** 换成最新的宿主能力（之后的 attach、链接、错误提示使用它们） */
  setLinks: (links: WebHostLinks) => void
}

/** 加载失败的错误码（web.state 的 failed）→ 应用的错误码（插件交给 describeError） */
const FAILURE_CODES: Readonly<Record<string, ErrorCode>> = {
  HTTP_400: 'FS_INVALID_URI',
  HTTP_403: 'FS_PERMISSION_DENIED',
  HTTP_404: 'FS_NOT_FOUND',
  HTTP_502: 'FS_UNAVAILABLE',
  HTTP_504: 'FS_TIMEOUT',
  ERR_FILE_NOT_FOUND: 'FS_NOT_FOUND'
}

const toPageState = (state: WebViewState): WebPageState => ({
  title: state.title,
  loading: state.loading,
  failed: state.failed === null ? null : (FAILURE_CODES[state.failed] ?? 'UNKNOWN')
})

/** 文件所在目录（不在任何条目之下时的范围根；驱动器根为 file:///C:/） */
function parentOf(uri: string): string {
  return normalizeRootUri(uri.slice(0, uri.lastIndexOf('/')))
}

/**
 * 占位元素的位置：getBoundingClientRect 的 CSS 像素即 DIP（宿主页面缩放为 1，不乘 devicePixelRatio），
 * 取整为 x = round(left)、width = round(right) - x（相邻元素之间不出现 1px 缝；台账 setBounds 一节）
 */
function measure(element: HTMLElement): WebBounds {
  const r = element.getBoundingClientRect()
  const x = Math.round(r.left)
  const y = Math.round(r.top)
  return {
    x,
    y,
    width: Math.max(0, Math.round(r.right) - x),
    height: Math.max(0, Math.round(r.bottom) - y)
  }
}

const sameBounds = (a: WebBounds, b: WebBounds): boolean =>
  a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height

interface Attachment {
  element: HTMLElement
  detach: () => void
}

/**
 * 预览宿主的浏览器视图部分（设计 5.2 / 5.3.1 / 5.3.6 / 5.3.7）：每个标签内容（PluginView）一个。
 * - attach：范围根 = 条目根（rootOf）?? 文件所在目录，发 web.attach；ResizeObserver + 窗口 resize → web.setBounds
 *   （同一帧内合并为一次，位置不变不发）；web.navigate → tabs.navigate / tabs.open（newTab）；
 *   web.shortcut → window 上的 keydown；刷新请求 → web.reload。
 * - 解除：标签仍在 attach 时的位置（URI 与查看器）→ web.hide（切换标签、工作区等，视图保活）；
 *   位置已变（导航离开、改用其他查看器）或标签已关闭 → web.release。
 * - 截图替身：见 WebHost.setCovered。只因 toast 而处于截图时，占位元素上的按下 → 收起 toast（不转发给页面）。
 */
export function createWebHost(deps: WebHostDeps): WebHost {
  const { tabId, views, invoke } = deps
  const env: WebHostEnv = { ...browserEnv, ...deps.env }
  const run = (task: () => Promise<unknown>): void => views.run(tabId, task)
  let links: WebHostLinks = { rootOf: deps.rootOf, tabs: deps.tabs, onError: deps.onError }

  let current: Attachment | null = null
  let covered = { overlay: false, toasts: false }
  /** 已请求截图替身（主进程中视图隐藏，或截图进行中） */
  let frozen = false

  const clearImage = (element: HTMLElement): void => {
    element.style.backgroundImage = ''
    element.style.backgroundSize = ''
  }

  const applyCover = (): void => {
    const want = current !== null && (covered.overlay || covered.toasts)
    if (want && !frozen && current !== null) {
      frozen = true
      const target = current
      run(async () => {
        const { image } = await invoke('web.freeze', { tabId })
        // 截图期间已解除遮挡 / 解除占位：不再显示这张图。空字符串 = 主进程中没有视图
        if (current !== target || !frozen || image === '') return
        target.element.style.backgroundImage = `url("${image}")`
        // 截图为物理像素，按占位元素的 CSS 尺寸缩放
        target.element.style.backgroundSize = '100% 100%'
      })
    } else if (!want && frozen) {
      frozen = false
      if (current !== null) {
        clearImage(current.element)
        run(() => invoke('web.unfreeze', { tabId }))
      }
    }
  }

  const attach: PreviewWebApi['attach'] = (element, uri, opts) => {
    current?.detach()
    const scopeRoot = links.rootOf(uri) ?? parentOf(uri)
    const at = deps.location()
    let lastBounds = measure(element)
    const initialBounds = lastBounds
    views.track(tabId)
    run(() =>
      invoke('web.attach', { tabId, uri, scopeRoot, view: opts.view, bounds: initialBounds })
    )

    let cancelFrame: (() => void) | null = null
    const scheduleBounds = (): void => {
      if (cancelFrame !== null) return
      cancelFrame = env.requestFrame(() => {
        cancelFrame = null
        if (current !== attachment) return
        const bounds = measure(element)
        if (sameBounds(bounds, lastBounds)) return
        lastBounds = bounds
        run(() => invoke('web.setBounds', { tabId, bounds }))
      })
    }
    const onPointerDown = (e: Event): void => {
      if (current !== attachment || !covered.toasts || covered.overlay) return
      e.preventDefault()
      deps.stashToasts()
    }
    element.addEventListener('pointerdown', onPointerDown)
    const offs = [
      () => element.removeEventListener('pointerdown', onPointerDown),
      env.observeResize(element, scheduleBounds),
      env.onWindowResize(scheduleBounds),
      deps.events.onNavigate((e) => {
        if (e.tabId !== tabId) return
        if (e.newTab) links.tabs.open(e.uri)
        else links.tabs.navigate(e.uri)
      }),
      deps.events.onShortcut((e) => {
        if (e.tabId !== tabId) return
        env.dispatchKey({
          key: e.key,
          ctrlKey: e.ctrl,
          shiftKey: e.shift,
          altKey: e.alt,
          bubbles: true,
          cancelable: true
        })
      }),
      deps.onRefresh(() => run(() => invoke('web.reload', { tabId })))
    ]

    const attachment: Attachment = {
      element,
      detach: () => {
        if (current !== attachment) return
        current = null
        cancelFrame?.()
        cancelFrame = null
        for (const off of offs) off()
        // 主进程的 hide / release 同时结束截图替身
        frozen = false
        clearImage(element)
        const now = deps.location()
        if (now === null || at === null || now.uri !== at.uri || now.viewer !== at.viewer) {
          views.release(tabId)
        } else {
          run(() => invoke('web.hide', { tabId }))
        }
      }
    }
    current = attachment
    applyCover()
    return attachment.detach
  }

  const api: PreviewWebApi = {
    attach,
    onState: (cb) => {
      const last = views.state(tabId)
      if (last !== undefined) cb(toPageState(last))
      return deps.events.onState((state) => {
        if (state.tabId === tabId) cb(toPageState(state))
      })
    },
    onNotice: (cb) =>
      deps.events.onNotice((e) => {
        if (e.tabId === tabId) cb(e.notice)
      }),
    reload: () => run(() => invoke('web.reload', { tabId })),
    openExternal: async (uri) => {
      try {
        await invoke('system.openPath', { uri })
      } catch (e) {
        links.onError(e)
      }
    }
  }

  return {
    api,
    setCovered: (next) => {
      covered = { ...next }
      applyCover()
    },
    setLinks: (next) => {
      links = next
    }
  }
}
