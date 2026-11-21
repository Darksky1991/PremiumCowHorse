import type { PreviewWebApi, WebPageState } from '@pch/plugin-sdk'
import {
  isUnderUri,
  normalizeRootUri,
  type ErrorCode,
  type WebBounds,
  type WebViewState
} from '@pch/shared'
import type { Invoke } from '@renderer/data/vfs'
import type { WebEvents } from '@renderer/data/web'

/**
 * 窗口级的浏览器视图登记（每个渲染端一个，preview-container 中创建）：
 * - 按标签串行执行 web.* 调用：web.freeze 要等 capturePage，期间到达的 web.unfreeze 若先执行，
 *   主进程会在截图完成后把视图隐藏而再也不显示；attach / hide / release 也必须保持顺序。
 * - 主进程中存在视图的标签及其「所有者」（最近一次 attach 的查看器插件 id）：标签关闭（含未激活、没有挂载插件的
 *   标签）时 web.release；标签当前位置改用其他查看器时由宿主 release（WebHost.setLocation）。
 * - 各标签视图的最近状态，连同当时 attach 的 URI（attach 复用视图且 URL 相同时主进程不再发 web.state，
 *   插件重新挂载时回放；只回放同一 URI 的状态——导航到另一页面时不能回放上一页的失败）。
 * - 各标签最近一次 attach 的范围根（与视图分开：视图 release 后也保留，标签关闭时忘记）：标签内跳转时沿用
 *   （PluginView 按位置重建，WebHost 记不住；见 createWebHost 的范围规则）。
 * - 视图内链接带的片段（`?查询#锚点`）：标签导航到该 URI 之后的下一次 attach 取走（只用一次）。
 */
export interface WebViews {
  run: (tabId: string, task: () => Promise<unknown>) => void
  /** 该标签视图最近的状态（只在它属于 uri 时返回） */
  state: (tabId: string, uri: string) => WebViewState | undefined
  /** 该标签在主进程中有视图（attach 之后）：所有者（查看器插件 id）与 attach 的 URI */
  track: (tabId: string, owner: string, uri: string) => void
  /** 该标签视图的所有者；没有视图时为 undefined */
  owner: (tabId: string) => string | undefined
  /** 销毁该标签的视图（排在该标签已发出的调用之后），忘记其状态。没有视图时不做任何事 */
  release: (tabId: string) => void
  /** 该标签最近一次 attach 的范围根；没有时为 undefined */
  scope: (tabId: string) => string | undefined
  setScope: (tabId: string, scopeRoot: string) => void
  /** 视图内链接的片段：之后该标签 attach uri 时带上 */
  setFragment: (tabId: string, uri: string, fragment: string) => void
  /** 取走该标签待用的片段（只在它属于 uri 时返回；不属于时丢弃） */
  takeFragment: (tabId: string, uri: string) => string | undefined
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
  const states = new Map<string, { uri: string; state: WebViewState }>()
  const tracked = new Map<string, { owner: string; uri: string }>()
  const scopes = new Map<string, string>()
  const fragments = new Map<string, { uri: string; fragment: string }>()

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
    if (!tracked.delete(tabId)) return
    states.delete(tabId)
    run(tabId, () => deps.invoke('web.release', { tabId }))
  }
  // 窗口生命周期内一直订阅（渲染端重新加载时主进程销毁全部视图，登记随页面一起消失）。
  // 状态归属于该标签当前 attach 的 URI
  deps.events.onState((state) => {
    const view = tracked.get(state.tabId)
    if (view) states.set(state.tabId, { uri: view.uri, state })
  })
  deps.onTabsChange(() => {
    for (const tabId of [...tracked.keys()]) if (!deps.tabExists(tabId)) release(tabId)
    for (const map of [scopes, fragments]) {
      for (const tabId of [...map.keys()]) if (!deps.tabExists(tabId)) map.delete(tabId)
    }
  })
  return {
    run,
    state: (tabId, uri) => {
      const entry = states.get(tabId)
      return entry?.uri === uri ? entry.state : undefined
    },
    track: (tabId, owner, uri) => {
      tracked.set(tabId, { owner, uri })
      const entry = states.get(tabId)
      if (entry && entry.uri !== uri) states.delete(tabId)
    },
    owner: (tabId) => tracked.get(tabId)?.owner,
    release,
    scope: (tabId) => scopes.get(tabId),
    setScope: (tabId, scopeRoot) => {
      scopes.set(tabId, scopeRoot)
    },
    setFragment: (tabId, uri, fragment) => {
      fragments.set(tabId, { uri, fragment })
    },
    takeFragment: (tabId, uri) => {
      const entry = fragments.get(tabId)
      fragments.delete(tabId)
      return entry?.uri === uri ? entry.fragment : undefined
    }
  }
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
  /** 让应用界面中持有焦点的元素失去焦点（焦点落到 body） */
  blurActive: () => void
  /** 应用界面没有焦点元素（activeElement 为 body）且文档持有焦点：用户没有在应用中操作 */
  idleFocus: () => boolean
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
  },
  blurActive: () => {
    const active = document.activeElement
    if (active instanceof HTMLElement && active !== document.body) active.blur()
  },
  idleFocus: () =>
    document.hasFocus() &&
    (document.activeElement === null || document.activeElement === document.body)
}

/** 本标签内容当前显示的位置与查看器（PluginView 解析出的插件 id，不是标签状态中的原始 viewer 字段） */
export interface WebLocation {
  pluginId: string
  uri: string
}

/** 取自预览宿主（PreviewHost）的能力：宿主随主题、条目等变化重建，经 WebHost.setLinks 换成最新的 */
export interface WebHostLinks {
  /** 标签所属工作区的 folder 条目的根 URI（范围根取包含页面的最外层者） */
  roots: readonly string[]
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
  /** 收起显示中的全部 toast 并收纳（messages-store 的 stashVisible） */
  stashToasts: () => void
  env?: Partial<WebHostEnv>
}

export interface WebHost {
  /** 交给插件的 PreviewHost.web */
  api: PreviewWebApi
  /**
   * 视图被应用界面遮挡的情况（overlay：打开中的弹出层；toasts：显示中的 toast）。任一为真时视图换成截图：
   * web.freeze → 占位元素背景 = 截图（主进程同时隐藏视图）；都为假时清除背景、web.unfreeze。
   * 视图持有的键盘焦点在截图时交回应用界面（隐藏的视图拿不住焦点）；只因 toast 时结束后还给视图，
   * 前提是期间用户没有在应用中操作（应用界面没有焦点元素）
   */
  setCovered: (covered: { overlay: boolean; toasts: boolean }) => void
  /** 换成最新的宿主能力（之后的 attach、链接、错误提示使用它们） */
  setLinks: (links: WebHostLinks) => void
  /**
   * 本标签内容当前的位置与查看器（PluginView 在布局阶段调用：早于插件 useEffect 中的 attach，
   * 也覆盖插件仍在懒加载中的情形）。该标签已有视图且所有者是另一个查看器 → web.release
   * （当前位置不再用这个网页查看器；同一查看器在新位置 attach 时复用视图，主进程加载新 URL）
   */
  setLocation: (location: WebLocation) => void
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

/** 包含 uri 的最外层 folder 条目根；不在任何条目之下时为 null */
function outermostRoot(roots: readonly string[], uri: string): string | null {
  let best: string | null = null
  for (const root of roots) {
    if (isUnderUri(uri, root) && (best === null || isUnderUri(best, root))) best = root
  }
  return best
}

/**
 * 范围根（设计 5.3.4 / doc 15）：本次的候选 = 包含页面的最外层 folder 条目根 ?? 文件所在目录。
 * 该标签记住的范围仍包含页面时沿用它（标签内跳转：Javadoc 的 index.html → pkg/Class.html 后
 * `../stylesheet.css` 仍指向正确的文件；源不变，localStorage / sessionStorage 不变），只有候选比它更宽
 * （首次 attach 时条目尚未加载、落到了文件所在目录）时换成候选。两者都包含页面，必为包含关系
 */
function scopeRootFor(
  uri: string,
  roots: readonly string[],
  remembered: string | undefined
): string {
  const candidate = outermostRoot(roots, uri) ?? parentOf(uri)
  if (remembered === undefined || !isUnderUri(uri, remembered)) return candidate
  return isUnderUri(remembered, candidate) ? candidate : remembered
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
 * - attach：范围根见 scopeRootFor（标签内跳转沿用），发 web.attach（带上视图内链接的片段）；
 *   ResizeObserver + 窗口 resize → web.setBounds（同一帧内合并为一次，位置不变不发）；
 *   web.navigate → tabs.navigate（片段交给 WebViews 留给下一次 attach）/ tabs.open（newTab，片段不带）；
 *   web.shortcut → window 上的 keydown；刷新请求 → web.reload。
 * - 解除（插件卸载）→ 只 web.hide（切换标签 / 工作区、导航离开都一样）。销毁只在：标签关闭（WebViews 订阅
 *   tabs-store）、本标签内容改用其他查看器（setLocation）、工作区总览（preview-container）。网页之间跳转时
 *   同一视图加载新 URL（同一个 webContents：sessionStorage 等得以保留）。
 * - 截图替身：见 WebHost.setCovered。只因 toast 而处于截图时，占位元素上的按下 → 收起 toast（不转发给页面）。
 */
export function createWebHost(deps: WebHostDeps): WebHost {
  const { tabId, views, invoke } = deps
  const env: WebHostEnv = { ...browserEnv, ...deps.env }
  const run = (task: () => Promise<unknown>): void => views.run(tabId, task)
  let links: WebHostLinks = { roots: deps.roots, tabs: deps.tabs, onError: deps.onError }
  let location: WebLocation | null = null

  let current: Attachment | null = null
  let covered = { overlay: false, toasts: false }
  /** 已请求截图替身（主进程中视图隐藏，或截图进行中） */
  let frozen = false
  /**
   * 只因 toast 截图、且主进程交回了页面持有的焦点：结束时若用户没有在应用中操作，把焦点还给视图。
   * 弹出层不还（用户正在应用中操作，关闭时 Base UI 把焦点还给触发按钮）
   */
  let refocus = false

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
        const { image, yielded } = await invoke('web.freeze', { tabId })
        if (current !== target) return
        if (yielded && frozen && !covered.overlay) {
          // 只因 toast：隐藏的视图拿不住焦点，主进程已交回应用界面。让应用中残留的焦点元素（例如资源树的行）
          // 失去焦点，页面中正在进行的输入不会落到它上面
          env.blurActive()
          refocus = true
        }
        // 截图期间已解除遮挡：不再显示这张图。空字符串 = 主进程中没有视图
        if (!frozen || image === '') return
        target.element.style.backgroundImage = `url("${image}")`
        // 截图为物理像素，按占位元素的 CSS 尺寸缩放
        target.element.style.backgroundSize = '100% 100%'
      })
    } else if (want && covered.overlay) {
      refocus = false
    } else if (!want && frozen) {
      frozen = false
      if (current !== null) {
        clearImage(current.element)
        // 在队列中判断（web.freeze 的结果处理之后）：截图期间用户把焦点移到了应用中则不还
        run(() => {
          const back = refocus && env.idleFocus()
          refocus = false
          return invoke('web.unfreeze', { tabId, refocus: back })
        })
      }
    }
  }

  const attach: PreviewWebApi['attach'] = (element, uri, opts) => {
    current?.detach()
    const scopeRoot = scopeRootFor(uri, links.roots, views.scope(tabId))
    views.setScope(tabId, scopeRoot)
    const fragment = views.takeFragment(tabId, uri)
    let lastBounds = measure(element)
    const initialBounds = lastBounds
    views.track(tabId, location?.pluginId ?? '', uri)
    run(() =>
      invoke('web.attach', {
        tabId,
        uri,
        scopeRoot,
        view: opts.view,
        bounds: initialBounds,
        ...(fragment ? { fragment } : {})
      })
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
        if (e.newTab) {
          links.tabs.open(e.uri)
          return
        }
        if (e.fragment !== '') views.setFragment(tabId, e.uri, e.fragment)
        links.tabs.navigate(e.uri)
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
        // 主进程的 hide 同时结束截图替身。标签关闭时视图已由 WebViews 销毁（store 的订阅早于卸载）
        frozen = false
        refocus = false
        clearImage(element)
        if (views.owner(tabId) !== undefined) run(() => invoke('web.hide', { tabId }))
      }
    }
    current = attachment
    applyCover()
    return attachment.detach
  }

  const api: PreviewWebApi = {
    attach,
    onState: (cb) => {
      // 只回放属于当前位置的状态（导航到另一页面时不回放上一页的失败）
      const last = location === null ? undefined : views.state(tabId, location.uri)
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
    },
    setLocation: (next) => {
      location = { ...next }
      const owner = views.owner(tabId)
      if (owner !== undefined && owner !== next.pluginId) views.release(tabId)
    }
  }
}
