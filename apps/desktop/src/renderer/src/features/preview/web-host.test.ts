import { describe, expect, it, vi } from 'vitest'
import type { IpcChannel, IpcEvents } from '@pch/shared'
import type { WebEvents } from '@renderer/data/web'
import { beginFocusReturn, consumeViewRefocus } from '@renderer/lib/focus-return'
import {
  createWebHost,
  createWebViews,
  type WebHostDeps,
  type WebHostEnv,
  type WebViews
} from './web-host'

const ROOT = 'file:///C:/%E6%A1%88%E4%BB%B6'
const INNER = `${ROOT}/proto`
const PAGE = `${INNER}/index.html`
const OUTSIDE = 'file://nas/share/docs/readme.html'
const SECOND = `${INNER}/second.html`
const HTML = 'pch.preview.html'
const TEXT = 'pch.preview.text'

type Listener<E extends keyof IpcEvents> = (payload: IpcEvents[E]) => void

/** 主进程事件的假实现：emit 相当于主进程发来的 web.* 事件 */
function fakeEvents(): {
  events: WebEvents
  emit: <E extends 'web.state' | 'web.navigate' | 'web.notice' | 'web.shortcut'>(
    event: E,
    payload: IpcEvents[E]
  ) => void
} {
  const listeners = new Map<string, Set<(payload: never) => void>>()
  const on =
    <E extends keyof IpcEvents>(event: E) =>
    (listener: Listener<E>): (() => void) => {
      const set = listeners.get(event) ?? new Set()
      listeners.set(event, set)
      set.add(listener as (payload: never) => void)
      return () => set.delete(listener as (payload: never) => void)
    }
  return {
    events: {
      onState: on('web.state'),
      onNavigate: on('web.navigate'),
      onNotice: on('web.notice'),
      onShortcut: on('web.shortcut')
    },
    emit: (event, payload) => {
      for (const l of listeners.get(event) ?? []) (l as Listener<typeof event>)(payload)
    }
  }
}

/** 占位元素的假实现：位置、内联样式、事件监听 */
function fakeElement(rect = { left: 10.4, top: 80.6, right: 610.5, bottom: 480.2 }): {
  element: HTMLElement
  rect: typeof rect
  style: Record<string, string>
  pointerDown: () => { defaultPrevented: boolean }
  listeners: () => number
} {
  const style: Record<string, string> = {}
  const listeners = new Map<string, Set<(e: Event) => void>>()
  const element = {
    style,
    getBoundingClientRect: () => ({ ...rect }),
    addEventListener: (type: string, l: (e: Event) => void) => {
      const set = listeners.get(type) ?? new Set()
      listeners.set(type, set)
      set.add(l)
    },
    removeEventListener: (type: string, l: (e: Event) => void) => listeners.get(type)?.delete(l)
  } as unknown as HTMLElement
  return {
    element,
    rect,
    style,
    pointerDown: () => {
      const e = {
        defaultPrevented: false,
        preventDefault() {
          this.defaultPrevented = true
        }
      }
      for (const l of listeners.get('pointerdown') ?? []) l(e as unknown as Event)
      return e
    },
    listeners: () => [...listeners.values()].reduce((n, s) => n + s.size, 0)
  }
}

interface Setup {
  host: ReturnType<typeof createWebHost>
  views: WebViews
  deps: WebHostDeps
  calls: Array<[IpcChannel, unknown]>
  emit: ReturnType<typeof fakeEvents>['emit']
  resize: () => void
  windowResize: () => void
  frames: () => void
  refresh: () => void
  keys: KeyboardEventInit[]
  tabsChanged: () => void
  existing: Set<string>
  /** 让 web.freeze 挂起直到 resolveFreeze */
  holdFreeze: () => void
  resolveFreeze: (image: string) => void
  /** web.freeze 的 yielded（视图持有焦点、主进程把焦点交回了应用界面） */
  focus: { yielded: boolean; idle: boolean; blurs: number }
}

function setup(overrides: Partial<WebHostDeps> = {}): Setup {
  const calls: Array<[IpcChannel, unknown]> = []
  let held: ((image: string) => void) | null = null
  let hold = false
  // idle：应用界面中没有焦点元素（document.activeElement 为 body）且文档持有焦点
  const focus = { yielded: false, idle: true, blurs: 0 }
  const invoke = vi.fn(async (channel: IpcChannel, input: unknown) => {
    calls.push([channel, input])
    if (channel === 'web.freeze') {
      const image = hold
        ? await new Promise<string>((r) => (held = r))
        : 'data:image/png;base64,AAAA'
      return { image, yielded: focus.yielded }
    }
    return undefined
  }) as unknown as WebHostDeps['invoke']
  const { events, emit } = fakeEvents()
  const resizeListeners = new Set<() => void>()
  const windowListeners = new Set<() => void>()
  const refreshListeners = new Set<() => void>()
  const tabsListeners = new Set<() => void>()
  let pending: Array<() => void> = []
  const keys: KeyboardEventInit[] = []
  const env: WebHostEnv = {
    observeResize: (_el, cb) => {
      resizeListeners.add(cb)
      return () => resizeListeners.delete(cb)
    },
    onWindowResize: (cb) => {
      windowListeners.add(cb)
      return () => windowListeners.delete(cb)
    },
    requestFrame: (cb) => {
      pending.push(cb)
      return () => {
        pending = pending.filter((p) => p !== cb)
      }
    },
    dispatchKey: (init) => keys.push(init),
    blurActive: () => {
      focus.blurs++
      focus.idle = true
    },
    idleFocus: () => focus.idle
  }
  const existing = new Set(['tab-1', 'tab-2'])
  const views = createWebViews({
    invoke,
    events,
    onTabsChange: (l) => {
      tabsListeners.add(l)
      return () => tabsListeners.delete(l)
    },
    tabExists: (id) => existing.has(id),
    onError: vi.fn()
  })
  const deps: WebHostDeps = {
    tabId: 'tab-1',
    views,
    invoke,
    events,
    // 嵌套的两个 folder 条目（ROOT 之下的 INNER）
    roots: [ROOT, INNER],
    tabs: { open: vi.fn(), navigate: vi.fn() },
    onRefresh: (l) => {
      refreshListeners.add(l)
      return () => refreshListeners.delete(l)
    },
    stashToasts: vi.fn(),
    onError: vi.fn(),
    env,
    ...overrides
  }
  const host = createWebHost(deps)
  // PluginView 在布局阶段告诉宿主当前的位置与查看器
  host.setLocation({ pluginId: HTML, uri: PAGE })
  return {
    host,
    views,
    deps,
    calls,
    emit,
    resize: () => resizeListeners.forEach((l) => l()),
    windowResize: () => windowListeners.forEach((l) => l()),
    frames: () => {
      const run = pending
      pending = []
      run.forEach((cb) => cb())
    },
    refresh: () => refreshListeners.forEach((l) => l()),
    keys,
    tabsChanged: () => tabsListeners.forEach((l) => l()),
    existing,
    holdFreeze: () => {
      hold = true
    },
    resolveFreeze: (image) => held?.(image),
    focus
  }
}

/** 宿主的 web.* 调用按标签串行执行（异步）：等它们发完 */
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0))
const channels = (calls: Setup['calls']): IpcChannel[] => calls.map(([c]) => c)

describe('createWebHost: attach', () => {
  it('sends web.attach with the outermost entry root as the scope and integer bounds', async () => {
    const s = setup()
    const { element } = fakeElement()
    s.host.api.attach(element, PAGE, { view: 'page' })
    await flush()
    expect(s.calls).toEqual([
      [
        'web.attach',
        {
          tabId: 'tab-1',
          uri: PAGE,
          // 嵌套条目：首次打开时取包含它的最外层条目根（子条目的页面能用 ../ 回到父条目）
          scopeRoot: ROOT,
          view: 'page',
          // x = round(left)、width = round(right) - x（相邻元素之间不留 1px 缝）
          bounds: { x: 10, y: 81, width: 601, height: 399 }
        }
      ]
    ])
  })

  it('uses the parent directory as the scope outside every entry', async () => {
    const s = setup()
    s.host.api.attach(fakeElement().element, OUTSIDE, { view: 'markdown' })
    await flush()
    expect(s.calls[0]?.[1]).toMatchObject({
      uri: OUTSIDE,
      scopeRoot: 'file://nas/share/docs',
      view: 'markdown'
    })
  })

  it('the parent of a file at a drive root is the drive root', async () => {
    const s = setup()
    s.host.api.attach(fakeElement().element, 'file:///D:/a.html', { view: 'page' })
    await flush()
    expect(s.calls[0]?.[1]).toMatchObject({ scopeRoot: 'file:///D:/' })
  })

  it('the returned function only hides the view', async () => {
    const s = setup()
    const el = fakeElement()
    const detach = s.host.api.attach(el.element, PAGE, { view: 'page' })
    detach()
    await flush()
    expect(channels(s.calls)).toEqual(['web.attach', 'web.hide'])
    // 监听全部移除；再次调用不重复发送
    expect(el.listeners()).toBe(0)
    detach()
    await flush()
    expect(channels(s.calls)).toEqual(['web.attach', 'web.hide'])
  })

  it('moving to another page with the same viewer keeps the view (hide, then attach the new uri)', async () => {
    const s = setup()
    s.host.api.attach(fakeElement().element, PAGE, { view: 'page' })()
    // 新位置的 PluginView（宿主按标签 id 新建）：同一查看器
    const next = createWebHost(s.deps)
    next.setLocation({ pluginId: HTML, uri: SECOND })
    next.api.attach(fakeElement().element, SECOND, { view: 'page' })
    await flush()
    expect(channels(s.calls)).toEqual(['web.attach', 'web.hide', 'web.attach'])
    expect(s.calls[2]?.[1]).toMatchObject({ uri: SECOND })
  })

  it('another viewer for the current location releases the view, even before the new plugin has loaded', async () => {
    for (const location of [
      { pluginId: TEXT, uri: `${INNER}/notes.md` },
      { pluginId: TEXT, uri: PAGE }
    ]) {
      const s = setup()
      s.host.api.attach(fakeElement().element, PAGE, { view: 'page' })()
      // 新插件仍在懒加载中：宿主只收到位置（布局阶段），没有 attach
      createWebHost(s.deps).setLocation(location)
      await flush()
      expect(channels(s.calls)).toEqual(['web.attach', 'web.hide', 'web.release'])
    }
  })

  it('the same viewer again (e.g. picked explicitly, or after a tab switch) does not release', async () => {
    const s = setup()
    s.host.api.attach(fakeElement().element, PAGE, { view: 'page' })()
    s.host.setLocation({ pluginId: HTML, uri: PAGE })
    createWebHost(s.deps).setLocation({ pluginId: HTML, uri: PAGE })
    await flush()
    expect(channels(s.calls)).toEqual(['web.attach', 'web.hide'])
  })

  it('a view released because its tab was closed is not hidden afterwards', async () => {
    const s = setup()
    const detach = s.host.api.attach(fakeElement().element, PAGE, { view: 'page' })
    // tabs-store 的订阅早于卸载
    s.existing.delete('tab-1')
    s.tabsChanged()
    detach()
    await flush()
    expect(channels(s.calls)).toEqual(['web.attach', 'web.release'])
  })

  it('coalesces several resizes in one frame into a single web.setBounds', async () => {
    const s = setup()
    const el = fakeElement()
    s.host.api.attach(el.element, PAGE, { view: 'page' })
    el.rect.right = 800.4
    s.resize()
    s.resize()
    s.windowResize()
    await flush()
    expect(channels(s.calls)).toEqual(['web.attach'])
    s.frames()
    await flush()
    expect(s.calls.slice(1)).toEqual([
      ['web.setBounds', { tabId: 'tab-1', bounds: { x: 10, y: 81, width: 790, height: 399 } }]
    ])
    // 位置没有变化的 resize 不发送
    s.resize()
    s.frames()
    await flush()
    expect(channels(s.calls)).toEqual(['web.attach', 'web.setBounds'])
  })
})

describe('createWebHost: scope of the pages in a tab', () => {
  const DOCS = 'file://nas/share/docs'
  /** 在新的位置 attach（每个位置一个新的 PluginView：宿主按标签 id 新建），返回这次 web.attach 的输入 */
  const attachAt = async (s: Setup, uri: string): Promise<{ input: unknown }> => {
    const host = createWebHost(s.deps)
    host.setLocation({ pluginId: HTML, uri })
    host.api.attach(fakeElement().element, uri, { view: 'page' })
    await flush()
    return { input: s.calls.filter(([c]) => c === 'web.attach').at(-1)?.[1] }
  }

  it('a page reached from another page keeps the scope (a file outside every entry and its subdirectory)', async () => {
    const s = setup({ roots: [] })
    expect((await attachAt(s, `${DOCS}/index.html`)).input).toMatchObject({ scopeRoot: DOCS })
    // Javadoc：index.html → pkg/Class.html。范围仍是 docs/（../stylesheet.css、../index.html 指向正确的文件）
    expect((await attachAt(s, `${DOCS}/pkg/Class.html`)).input).toMatchObject({ scopeRoot: DOCS })
    expect((await attachAt(s, `${DOCS}/index.html`)).input).toMatchObject({ scopeRoot: DOCS })
  })

  it('a page in a nested entry reached from the outer entry keeps the outer scope', async () => {
    const s = setup()
    expect((await attachAt(s, `${ROOT}/index.html`)).input).toMatchObject({ scopeRoot: ROOT })
    expect((await attachAt(s, PAGE)).input).toMatchObject({ scopeRoot: ROOT })
  })

  it('a location outside the remembered scope gets its own scope', async () => {
    const s = setup({ roots: [] })
    await attachAt(s, `${DOCS}/pkg/Class.html`)
    expect((await attachAt(s, `${DOCS}/index.html`)).input).toMatchObject({ scopeRoot: DOCS })
    expect((await attachAt(s, 'file://nas/share/other/a.html')).input).toMatchObject({
      scopeRoot: 'file://nas/share/other'
    })
  })

  it('an entry root that contains the remembered scope replaces it (the entries were not loaded yet at the first attach)', async () => {
    const s = setup({ roots: [] })
    expect((await attachAt(s, PAGE)).input).toMatchObject({ scopeRoot: INNER })
    s.deps.roots = [ROOT]
    expect((await attachAt(s, `${INNER}/sub/x.html`)).input).toMatchObject({ scopeRoot: ROOT })
  })

  it('the scope is remembered across a release (another viewer in between) and forgotten when the tab closes', async () => {
    const s = setup({ roots: [] })
    await attachAt(s, `${DOCS}/index.html`)
    // 中间改用文本查看器 → 视图销毁
    createWebHost(s.deps).setLocation({ pluginId: TEXT, uri: `${DOCS}/pkg/notes.txt` })
    expect((await attachAt(s, `${DOCS}/pkg/Class.html`)).input).toMatchObject({ scopeRoot: DOCS })
    s.existing.delete('tab-1')
    s.tabsChanged()
    s.existing.add('tab-1')
    expect((await attachAt(s, `${DOCS}/pkg/Class.html`)).input).toMatchObject({
      scopeRoot: `${DOCS}/pkg`
    })
  })

  it('a link with #fragment / ?query: the next attach of that uri in this tab loads it with them, only once', async () => {
    const s = setup()
    s.host.api.attach(fakeElement().element, PAGE, { view: 'page' })
    s.emit('web.navigate', { tabId: 'tab-1', uri: SECOND, newTab: false, fragment: '?q=1#sec' })
    expect(s.deps.tabs.navigate).toHaveBeenCalledExactlyOnceWith(SECOND)
    expect((await attachAt(s, SECOND)).input).toMatchObject({ uri: SECOND, fragment: '?q=1#sec' })
    // 之后再显示（切换标签回来等）不再带
    expect((await attachAt(s, SECOND)).input).not.toHaveProperty('fragment')
    // 片段属于它的 uri：导航没有发生（例如 stat 失败）而显示了别的页面时丢弃
    s.emit('web.navigate', { tabId: 'tab-1', uri: SECOND, newTab: false, fragment: '#x' })
    expect((await attachAt(s, PAGE)).input).not.toHaveProperty('fragment')
    expect((await attachAt(s, SECOND)).input).not.toHaveProperty('fragment')
  })
})

describe('createWebHost: events from the view', () => {
  it('web.navigate opens in this tab, or in a new tab for newTab; other tabs are ignored', async () => {
    const s = setup()
    s.host.api.attach(fakeElement().element, PAGE, { view: 'page' })
    s.emit('web.navigate', {
      tabId: 'tab-1',
      uri: `${INNER}/second.html`,
      newTab: false,
      fragment: ''
    })
    s.emit('web.navigate', {
      tabId: 'tab-1',
      uri: `${INNER}/third.html`,
      newTab: true,
      fragment: ''
    })
    s.emit('web.navigate', {
      tabId: 'tab-2',
      uri: `${INNER}/other.html`,
      newTab: false,
      fragment: ''
    })
    expect(s.deps.tabs.navigate).toHaveBeenCalledExactlyOnceWith(`${INNER}/second.html`)
    expect(s.deps.tabs.open).toHaveBeenCalledExactlyOnceWith(`${INNER}/third.html`)
  })

  it('web.shortcut is dispatched as a keydown on the window; refresh reloads the view', async () => {
    const s = setup()
    s.host.api.attach(fakeElement().element, PAGE, { view: 'page' })
    s.emit('web.shortcut', { tabId: 'tab-1', key: 'w', ctrl: true, shift: false, alt: false })
    s.emit('web.shortcut', { tabId: 'tab-2', key: 'F5', ctrl: false, shift: false, alt: false })
    expect(s.keys).toEqual([
      { key: 'w', ctrlKey: true, shiftKey: false, altKey: false, bubbles: true, cancelable: true }
    ])
    s.refresh()
    await flush()
    expect(s.calls.slice(1)).toEqual([['web.reload', { tabId: 'tab-1' }]])
  })

  it('stops listening after detaching', async () => {
    const s = setup()
    s.host.api.attach(fakeElement().element, PAGE, { view: 'page' })()
    s.emit('web.navigate', {
      tabId: 'tab-1',
      uri: `${INNER}/second.html`,
      newTab: false,
      fragment: ''
    })
    s.refresh()
    await flush()
    expect(s.deps.tabs.navigate).not.toHaveBeenCalled()
    expect(channels(s.calls)).toEqual(['web.attach', 'web.hide'])
  })

  it('onState replays the last state of the tab and maps load failures to error codes', () => {
    const s = setup()
    s.host.api.attach(fakeElement().element, PAGE, { view: 'page' })
    s.emit('web.state', { tabId: 'tab-1', title: 'Proto', loading: false, failed: null })
    const states: unknown[] = []
    const off = s.host.api.onState((state) => states.push(state))
    s.emit('web.state', { tabId: 'tab-2', title: 'Other', loading: false, failed: null })
    s.emit('web.state', { tabId: 'tab-1', title: '', loading: false, failed: 'HTTP_404' })
    s.emit('web.state', { tabId: 'tab-1', title: '', loading: false, failed: 'ERR_FAILED' })
    off()
    s.emit('web.state', { tabId: 'tab-1', title: 'late', loading: true, failed: null })
    expect(states).toEqual([
      { title: 'Proto', loading: false, failed: null },
      { title: '', loading: false, failed: 'FS_NOT_FOUND' },
      { title: '', loading: false, failed: 'UNKNOWN' }
    ])
  })

  it('onState does not replay the state of another page (a failure stays with its page)', () => {
    const s = setup()
    s.host.api.attach(fakeElement().element, PAGE, { view: 'page' })()
    s.emit('web.state', { tabId: 'tab-1', title: '', loading: false, failed: 'HTTP_404' })
    const next = createWebHost(s.deps)
    next.setLocation({ pluginId: HTML, uri: SECOND })
    const states: unknown[] = []
    next.api.onState((state) => states.push(state))
    expect(states).toEqual([])
    // 回到失败的那一页：仍然回放（attach 之前）
    const back = createWebHost(s.deps)
    back.setLocation({ pluginId: HTML, uri: PAGE })
    back.api.onState((state) => states.push(state))
    expect(states).toEqual([{ title: '', loading: false, failed: 'FS_NOT_FOUND' }])
    // 新页面 attach 后旧状态作废
    next.api.attach(fakeElement().element, SECOND, { view: 'page' })
    expect(s.views.state('tab-1', PAGE)).toBeUndefined()
  })

  it('onNotice only reports notices of this tab', () => {
    const s = setup()
    const notices: unknown[] = []
    s.host.api.onNotice((n) => notices.push(n))
    s.emit('web.notice', { tabId: 'tab-2', notice: 'download' })
    s.emit('web.notice', { tabId: 'tab-1', notice: 'outOfScope' })
    expect(notices).toEqual(['outOfScope'])
  })
})

describe('createWebHost: screenshot stand-in', () => {
  it('freezes while covered (the placeholder shows the image) and unfreezes afterwards', async () => {
    const s = setup()
    const el = fakeElement()
    s.host.api.attach(el.element, PAGE, { view: 'page' })
    s.host.setCovered({ overlay: true, toasts: false })
    await flush()
    expect(channels(s.calls)).toEqual(['web.attach', 'web.freeze'])
    expect(el.style.backgroundImage).toBe('url("data:image/png;base64,AAAA")')
    s.host.setCovered({ overlay: true, toasts: true })
    await flush()
    expect(channels(s.calls)).toEqual(['web.attach', 'web.freeze'])
    s.host.setCovered({ overlay: false, toasts: false })
    await flush()
    expect(channels(s.calls)).toEqual(['web.attach', 'web.freeze', 'web.unfreeze'])
    expect(el.style.backgroundImage).toBe('')
    expect(s.calls[2]).toEqual(['web.unfreeze', { tabId: 'tab-1', refocus: false }])
  })

  describe('keyboard focus of the page', () => {
    it('toasts alone: the app element that held the focus is blurred; afterwards the page gets the focus back', async () => {
      const s = setup()
      s.focus.yielded = true
      s.focus.idle = false // 应用中残留着之前的焦点元素（例如资源树的行）
      s.host.api.attach(fakeElement().element, PAGE, { view: 'page' })
      s.host.setCovered({ overlay: false, toasts: true })
      await flush()
      // 页面中正在进行的输入不会落到那个元素上
      expect(s.focus.blurs).toBe(1)
      s.host.setCovered({ overlay: false, toasts: false })
      await flush()
      expect(s.calls.at(-1)).toEqual(['web.unfreeze', { tabId: 'tab-1', refocus: true }])
    })

    it('an overlay dismissed with a refocus request gives the focus back to the page; without one it does not', async () => {
      vi.stubGlobal('HTMLElement', class {})
      vi.stubGlobal('document', { hasFocus: () => true, activeElement: null, body: {} })
      for (const requested of [true, false]) {
        const focusReturn = beginFocusReturn()
        const s = setup()
        s.focus.yielded = true
        s.host.api.attach(fakeElement().element, PAGE, { view: 'page' })
        s.host.setCovered({ overlay: true, toasts: false })
        await flush()
        // 浮层自己的输入框持有焦点：不能被 blur
        expect(s.focus.blurs).toBe(0)
        if (requested) focusReturn.restore() // 浮层被关闭（不是执行了动作）
        s.host.setCovered({ overlay: false, toasts: false })
        await flush()
        expect(s.calls.at(-1)).toEqual(['web.unfreeze', { tabId: 'tab-1', refocus: requested }])
        consumeViewRefocus()
      }
      vi.unstubAllGlobals()
    })

    it('toasts alone: the focus moved into the app meanwhile (e.g. the tree) stays there', async () => {
      const s = setup()
      s.focus.yielded = true
      s.host.api.attach(fakeElement().element, PAGE, { view: 'page' })
      s.host.setCovered({ overlay: false, toasts: true })
      await flush()
      s.focus.idle = false // 用户把焦点移到了资源树
      s.host.setCovered({ overlay: false, toasts: false })
      await flush()
      expect(s.calls.at(-1)).toEqual(['web.unfreeze', { tabId: 'tab-1', refocus: false }])
    })

    it('a popup (from the start or opened during a toast) keeps the focus in the app', async () => {
      for (const steps of [
        [{ overlay: true, toasts: false }],
        [
          { overlay: false, toasts: true },
          { overlay: true, toasts: true },
          { overlay: false, toasts: true }
        ]
      ]) {
        const s = setup()
        s.focus.yielded = true
        s.host.api.attach(fakeElement().element, PAGE, { view: 'page' })
        for (const covered of steps) {
          s.host.setCovered(covered)
          await flush()
        }
        s.host.setCovered({ overlay: false, toasts: false })
        await flush()
        expect(s.calls.at(-1)).toEqual(['web.unfreeze', { tabId: 'tab-1', refocus: false }])
        expect(channels(s.calls).filter((c) => c === 'web.freeze')).toHaveLength(1)
      }
    })

    it('a page without the focus does not get it', async () => {
      const s = setup()
      s.host.api.attach(fakeElement().element, PAGE, { view: 'page' })
      s.host.setCovered({ overlay: false, toasts: true })
      await flush()
      s.host.setCovered({ overlay: false, toasts: false })
      await flush()
      expect(s.focus.blurs).toBe(0)
      expect(s.calls.at(-1)).toEqual(['web.unfreeze', { tabId: 'tab-1', refocus: false }])
    })
  })

  it('an uncover during the capture waits for it and does not leave the image behind', async () => {
    const s = setup()
    const el = fakeElement()
    s.host.api.attach(el.element, PAGE, { view: 'page' })
    s.holdFreeze()
    s.host.setCovered({ overlay: true, toasts: false })
    await flush()
    s.host.setCovered({ overlay: false, toasts: false })
    await flush()
    // web.unfreeze 排在 web.freeze 完成之后（否则主进程先 unfreeze、后隐藏，视图一直不显示）
    expect(channels(s.calls)).toEqual(['web.attach', 'web.freeze'])
    s.resolveFreeze('data:image/png;base64,BBBB')
    await flush()
    expect(channels(s.calls)).toEqual(['web.attach', 'web.freeze', 'web.unfreeze'])
    expect(el.style.backgroundImage ?? '').toBe('')
  })

  it('attaching while covered freezes right away; detaching clears the image', async () => {
    const s = setup()
    const el = fakeElement()
    s.host.setCovered({ overlay: false, toasts: true })
    await flush()
    expect(s.calls).toEqual([])
    const detach = s.host.api.attach(el.element, PAGE, { view: 'page' })
    await flush()
    expect(channels(s.calls)).toEqual(['web.attach', 'web.freeze'])
    detach()
    await flush()
    expect(channels(s.calls)).toEqual(['web.attach', 'web.freeze', 'web.hide'])
    expect(el.style.backgroundImage).toBe('')
  })

  it('an empty image (no view in the main process) leaves the placeholder blank', async () => {
    const s = setup()
    const el = fakeElement()
    s.host.api.attach(el.element, PAGE, { view: 'page' })
    s.holdFreeze()
    s.host.setCovered({ overlay: true, toasts: false })
    await flush()
    s.resolveFreeze('')
    await flush()
    expect(el.style.backgroundImage ?? '').toBe('')
  })

  it('a pointer down on the stand-in stashes the toasts only when toasts alone cover the view', async () => {
    const s = setup()
    const el = fakeElement()
    s.host.api.attach(el.element, PAGE, { view: 'page' })
    expect(el.pointerDown().defaultPrevented).toBe(false)
    s.host.setCovered({ overlay: true, toasts: true })
    expect(el.pointerDown().defaultPrevented).toBe(false)
    expect(s.deps.stashToasts).not.toHaveBeenCalled()
    s.host.setCovered({ overlay: false, toasts: true })
    expect(el.pointerDown().defaultPrevented).toBe(true)
    expect(s.deps.stashToasts).toHaveBeenCalledTimes(1)
  })
})

describe('createWebViews', () => {
  it('releases the view of a tab that was closed elsewhere (not mounted)', async () => {
    const s = setup()
    const detach = s.host.api.attach(fakeElement().element, PAGE, { view: 'page' })
    detach()
    await flush()
    s.existing.delete('tab-2')
    s.tabsChanged()
    await flush()
    expect(channels(s.calls)).toEqual(['web.attach', 'web.hide'])
    s.existing.delete('tab-1')
    s.tabsChanged()
    s.tabsChanged()
    await flush()
    expect(channels(s.calls)).toEqual(['web.attach', 'web.hide', 'web.release'])
  })

  it('forgets the state of a released tab', async () => {
    const s = setup()
    s.host.api.attach(fakeElement().element, PAGE, { view: 'page' })
    s.emit('web.state', { tabId: 'tab-1', title: 'Proto', loading: false, failed: null })
    expect(s.views.state('tab-1', PAGE)).toMatchObject({ title: 'Proto' })
    s.views.release('tab-1')
    expect(s.views.state('tab-1', PAGE)).toBeUndefined()
  })

  it('release without a view (e.g. the workspace overview) sends nothing', async () => {
    const s = setup()
    s.views.release('tab-1')
    await flush()
    expect(s.calls).toEqual([])
  })
})
