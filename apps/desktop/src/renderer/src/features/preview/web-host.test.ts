import { describe, expect, it, vi } from 'vitest'
import type { IpcChannel, IpcEvents } from '@pch/shared'
import type { WebEvents } from '@renderer/data/web'
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
  location: { current: { uri: string; viewer: string | null } | null }
  tabsChanged: () => void
  existing: Set<string>
  /** 让 web.freeze 挂起直到 resolveFreeze */
  holdFreeze: () => void
  resolveFreeze: (image: string) => void
}

function setup(overrides: Partial<WebHostDeps> = {}): Setup {
  const calls: Array<[IpcChannel, unknown]> = []
  let held: ((image: string) => void) | null = null
  let hold = false
  const invoke = vi.fn(async (channel: IpcChannel, input: unknown) => {
    calls.push([channel, input])
    if (channel === 'web.freeze') {
      if (hold) return { image: await new Promise<string>((r) => (held = r)) }
      return { image: 'data:image/png;base64,AAAA' }
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
    dispatchKey: (init) => keys.push(init)
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
  const location: Setup['location'] = { current: { uri: PAGE, viewer: null } }
  const deps: WebHostDeps = {
    tabId: 'tab-1',
    views,
    invoke,
    events,
    rootOf: (uri) => (uri.startsWith(`${INNER}/`) ? INNER : uri.startsWith(ROOT) ? ROOT : null),
    tabs: { open: vi.fn(), navigate: vi.fn() },
    onRefresh: (l) => {
      refreshListeners.add(l)
      return () => refreshListeners.delete(l)
    },
    location: () => location.current,
    stashToasts: vi.fn(),
    onError: vi.fn(),
    env,
    ...overrides
  }
  return {
    host: createWebHost(deps),
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
    location,
    tabsChanged: () => tabsListeners.forEach((l) => l()),
    existing,
    holdFreeze: () => {
      hold = true
    },
    resolveFreeze: (image) => held?.(image)
  }
}

/** 宿主的 web.* 调用按标签串行执行（异步）：等它们发完 */
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0))
const channels = (calls: Setup['calls']): IpcChannel[] => calls.map(([c]) => c)

describe('createWebHost: attach', () => {
  it('sends web.attach with the entry root as the scope and integer bounds', async () => {
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
          scopeRoot: INNER,
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

  it('the returned function only hides the view while the tab stays at the location', async () => {
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

  it('releases the view when the tab moved to another location, picked another viewer or was closed', async () => {
    for (const next of [
      { uri: `${INNER}/notes.md`, viewer: null },
      { uri: PAGE, viewer: 'pch.preview.text' },
      null
    ]) {
      const s = setup()
      const detach = s.host.api.attach(fakeElement().element, PAGE, { view: 'page' })
      s.location.current = next
      detach()
      await flush()
      expect(channels(s.calls)).toEqual(['web.attach', 'web.release'])
    }
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

describe('createWebHost: events from the view', () => {
  it('web.navigate opens in this tab, or in a new tab for newTab; other tabs are ignored', async () => {
    const s = setup()
    s.host.api.attach(fakeElement().element, PAGE, { view: 'page' })
    s.emit('web.navigate', { tabId: 'tab-1', uri: `${INNER}/second.html`, newTab: false })
    s.emit('web.navigate', { tabId: 'tab-1', uri: `${INNER}/third.html`, newTab: true })
    s.emit('web.navigate', { tabId: 'tab-2', uri: `${INNER}/other.html`, newTab: false })
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
    s.emit('web.navigate', { tabId: 'tab-1', uri: `${INNER}/second.html`, newTab: false })
    s.refresh()
    await flush()
    expect(s.deps.tabs.navigate).not.toHaveBeenCalled()
    expect(channels(s.calls)).toEqual(['web.attach', 'web.hide'])
  })

  it('onState replays the last state of the tab and maps load failures to error codes', () => {
    const s = setup()
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
    expect(s.views.state('tab-1')).toMatchObject({ title: 'Proto' })
    s.views.release('tab-1')
    expect(s.views.state('tab-1')).toBeUndefined()
  })
})
