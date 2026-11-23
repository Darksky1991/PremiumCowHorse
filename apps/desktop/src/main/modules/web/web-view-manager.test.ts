import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WebBounds } from '@pch/shared'
import { ScopeTable, toWebUrl } from './scope'
import {
  WEB_VIEW_LIMIT,
  WebViewManager,
  type AttachInput,
  type OwnerWindow,
  type SendToWindow,
  type ViewEvents,
  type ViewLike
} from './web-view-manager'

const ROOT = 'file:///C:/work/proto'
const BOUNDS: WebBounds = { x: 10, y: 20, width: 300, height: 200 }

class FakeView implements ViewLike {
  static nextId = 100
  bounds: WebBounds | null = null
  visible = false
  destroyed = false
  readonly loads: string[] = []
  reloads = 0
  readonly scripts: string[] = []
  /** 键盘焦点在本视图中 */
  focused = false
  readonly webContents = {
    id: FakeView.nextId++,
    loadURL: async (url: string): Promise<void> => {
      this.loads.push(url)
    },
    reload: (): void => {
      this.reloads++
    },
    executeJavaScript: async (code: string): Promise<unknown> => {
      this.scripts.push(code)
      return undefined
    },
    capturePage: async () => ({ toDataURL: () => 'data:image/png;base64,AAAA' }),
    isFocused: (): boolean => this.focused,
    focus: (): void => {
      this.focused = true
    }
  }
  constructor(readonly events: ViewEvents) {}
  setBounds(b: WebBounds): void {
    this.bounds = b
  }
  setVisible(v: boolean): void {
    this.visible = v
  }
  destroy(): void {
    this.destroyed = true
  }
}

class FakeOwner implements OwnerWindow {
  readonly added: ViewLike[] = []
  /** focus() 的调用次数（焦点交回应用界面） */
  focuses = 0
  constructor(readonly id: number) {}
  focus(): void {
    this.focuses++
  }
  add(view: ViewLike): void {
    this.added.push(view)
  }
}

describe('WebViewManager', () => {
  let views: FakeView[]
  let send: ReturnType<typeof vi.fn<SendToWindow>>
  let scopes: ScopeTable
  let manager: WebViewManager
  let win: FakeOwner

  const input = (
    tabId: string,
    file = 'index.html',
    extra: Partial<AttachInput> = {}
  ): AttachInput => ({
    tabId,
    uri: `${ROOT}/${file}`,
    scopeRoot: ROOT,
    view: 'page' as const,
    bounds: BOUNDS,
    ...extra
  })
  const viewOf = (i: number): FakeView => views[i]!

  beforeEach(() => {
    views = []
    send = vi.fn<SendToWindow>()
    scopes = new ScopeTable()
    manager = new WebViewManager({
      createView: (events) => {
        const v = new FakeView(events)
        views.push(v)
        return v
      },
      send,
      scopes,
      openExternal: vi.fn(),
      logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() }
    })
    win = new FakeOwner(1)
  })

  it('attach 新建视图：登记范围、加入窗口、放到位置、显示并加载 pch-web 地址', () => {
    manager.attach(win, input('t1'))
    expect(views).toHaveLength(1)
    const v = viewOf(0)
    expect(win.added).toEqual([v])
    expect(v.bounds).toEqual(BOUNDS)
    expect(v.visible).toBe(true)
    expect(v.loads).toEqual([toWebUrl(`${ROOT}/index.html`, ROOT)])
    expect(scopes.rootOf(new URL(v.loads[0]!).hostname)).toBe(ROOT)
  })

  it('markdown 视图的地址带 ?pch-view=markdown', () => {
    manager.attach(win, input('t1', 'README.md', { view: 'markdown' }))
    expect(viewOf(0).loads).toEqual([`${toWebUrl(`${ROOT}/README.md`, ROOT)}?pch-view=markdown`])
  })

  it('范围根带结尾 / 时规范化（范围编号与不带 / 相同）', () => {
    manager.attach(win, input('t1', 'a.html', { scopeRoot: `${ROOT}/` }))
    expect(viewOf(0).loads).toEqual([toWebUrl(`${ROOT}/a.html`, ROOT)])
  })

  it('uri 不在 scopeRoot 之下 → 抛 FS_INVALID_URI，不创建视图', () => {
    expect(() =>
      manager.attach(win, input('t1', 'x', { uri: 'file:///C:/Windows/win.ini' }))
    ).toThrow(expect.objectContaining({ code: 'FS_INVALID_URI' }))
    expect(views).toHaveLength(0)
  })

  it('同标签第二次 attach 复用视图，URL 相同不重新加载；URL 不同才 loadURL', () => {
    manager.attach(win, input('t1'))
    manager.hide(win.id, 't1')
    const moved = { ...BOUNDS, x: 50 }
    manager.attach(win, input('t1', 'index.html', { bounds: moved }))
    expect(views).toHaveLength(1)
    const v = viewOf(0)
    expect(v.loads).toHaveLength(1)
    expect(v.bounds).toEqual(moved)
    expect(v.visible).toBe(true)
    expect(win.added).toHaveLength(2) // 再次加入 = 移到最上层

    manager.attach(win, input('t1', 'second.html'))
    expect(v.loads).toEqual([
      toWebUrl(`${ROOT}/index.html`, ROOT),
      toWebUrl(`${ROOT}/second.html`, ROOT)
    ])
  })

  it('fragment 拼到加载的地址后；是否重新加载只看不含它的地址', () => {
    manager.attach(win, input('t1'))
    manager.attach(win, input('t1', 'second.html', { fragment: '?q=1#sec' }))
    const second = toWebUrl(`${ROOT}/second.html`, ROOT)
    expect(viewOf(0).loads).toEqual([toWebUrl(`${ROOT}/index.html`, ROOT), `${second}?q=1#sec`])
    // 之后不带片段再 attach 同一页面（切换标签回来）：不重新加载
    manager.hide(win.id, 't1')
    manager.attach(win, input('t1', 'second.html'))
    expect(viewOf(0).loads).toHaveLength(2)
  })

  it('markdown 视图的 fragment：只取 #锚点（查询固定为 ?pch-view=markdown）', () => {
    manager.attach(win, input('t1', 'README.md', { view: 'markdown', fragment: '?x=1#intro' }))
    expect(viewOf(0).loads).toEqual([
      `${toWebUrl(`${ROOT}/README.md`, ROOT)}?pch-view=markdown#intro`
    ])
  })

  it(`第 ${WEB_VIEW_LIMIT + 1} 个 attach 销毁最久未显示者，显示中的不销毁`, () => {
    // t0 一直显示（最早显示）；t1..t7 显示后隐藏
    manager.attach(win, input('t0'))
    for (let i = 1; i < WEB_VIEW_LIMIT; i++) {
      manager.attach(win, input(`t${i}`))
      manager.hide(win.id, `t${i}`)
    }
    expect(views.some((v) => v.destroyed)).toBe(false)
    manager.attach(win, input(`t${WEB_VIEW_LIMIT}`))
    expect(views.filter((v) => v.destroyed)).toEqual([viewOf(1)])
    expect(viewOf(0).destroyed).toBe(false)

    // 被销毁的标签再次显示 → 新建视图并重新加载（又淘汰下一个最久未显示的 t2）
    manager.attach(win, input('t1'))
    expect(views).toHaveLength(WEB_VIEW_LIMIT + 2)
    expect(views.at(-1)!.loads).toHaveLength(1)
    expect(viewOf(2).destroyed).toBe(true)
  })

  it('隐藏时间也算「最近显示」：先隐藏的先被淘汰', () => {
    for (let i = 0; i < WEB_VIEW_LIMIT; i++) manager.attach(win, input(`t${i}`))
    // 全部显示中；倒序隐藏 → t7 最先隐藏，最久未显示
    for (let i = WEB_VIEW_LIMIT - 1; i >= 0; i--) manager.hide(win.id, `t${i}`)
    manager.attach(win, input('new'))
    expect(views.filter((v) => v.destroyed)).toEqual([viewOf(WEB_VIEW_LIMIT - 1)])
  })

  it('上限按窗口计算', () => {
    const win2 = new FakeOwner(2)
    for (let i = 0; i < WEB_VIEW_LIMIT; i++) {
      manager.attach(win, input(`a${i}`))
      manager.hide(win.id, `a${i}`)
      manager.attach(win2, input(`b${i}`))
      manager.hide(win2.id, `b${i}`)
    }
    expect(views.some((v) => v.destroyed)).toBe(false)
  })

  it('release 销毁视图；之后的调用不做任何事', async () => {
    manager.attach(win, input('t1'))
    manager.release(win.id, 't1')
    expect(viewOf(0).destroyed).toBe(true)
    manager.setBounds(win.id, 't1', BOUNDS)
    manager.reload(win.id, 't1')
    manager.hide(win.id, 't1')
    expect(await manager.freeze(win.id, 't1')).toEqual({ image: '', yielded: false })
    expect(viewOf(0).reloads).toBe(0)
  })

  it('setMarkdownTheme：只对 Markdown 视图执行主题切换脚本（default 移除属性），不重新加载', () => {
    manager.attach(win, input('md', 'notes.md', { view: 'markdown' }))
    manager.attach(win, input('web'))
    manager.setMarkdownTheme('washi')
    expect(viewOf(0).scripts).toEqual(["document.documentElement.dataset.theme = 'washi'"])
    expect(viewOf(1).scripts).toEqual([])
    manager.setMarkdownTheme('default')
    expect(viewOf(0).scripts[1]).toBe('delete document.documentElement.dataset.theme')
    expect(viewOf(0).reloads).toBe(0)
  })

  it('同一标签 id 在不同窗口是不同的视图', () => {
    const win2 = new FakeOwner(2)
    manager.attach(win, input('t1'))
    manager.attach(win2, input('t1'))
    expect(views).toHaveLength(2)
    manager.release(win2.id, 't1')
    expect(viewOf(0).destroyed).toBe(false)
    expect(viewOf(1).destroyed).toBe(true)
  })

  it('disposeWindow 只销毁该窗口的视图；dispose 销毁全部', () => {
    const win2 = new FakeOwner(2)
    manager.attach(win, input('a'))
    manager.attach(win, input('b'))
    manager.attach(win2, input('c'))
    manager.disposeWindow(win.id)
    expect(views.map((v) => v.destroyed)).toEqual([true, true, false])
    manager.dispose()
    expect(viewOf(2).destroyed).toBe(true)
  })

  it('setBounds / reload 作用于对应视图', () => {
    manager.attach(win, input('t1'))
    const b = { x: 1, y: 2, width: 3, height: 4 }
    manager.setBounds(win.id, 't1', b)
    manager.reload(win.id, 't1')
    expect(viewOf(0).bounds).toEqual(b)
    expect(viewOf(0).reloads).toBe(1)
  })

  it('freeze 返回 data URL 并隐藏视图；unfreeze 恢复显示', async () => {
    manager.attach(win, input('t1'))
    const { image } = await manager.freeze(win.id, 't1')
    expect(image).toBe('data:image/png;base64,AAAA')
    expect(viewOf(0).visible).toBe(false)
    manager.unfreeze(win.id, 't1', false)
    expect(viewOf(0).visible).toBe(true)
  })

  describe('键盘焦点：隐藏 / 截图 / 销毁持有焦点的视图时交回应用界面', () => {
    it('hide：视图持有焦点时交回所属窗口；没有焦点时不动', () => {
      manager.attach(win, input('t1'))
      manager.attach(win, input('t2', 'b.html'))
      viewOf(0).focused = true
      manager.hide(win.id, 't1')
      expect(win.focuses).toBe(1)
      manager.hide(win.id, 't2')
      expect(win.focuses).toBe(1)
    })

    it('release：视图持有焦点时先交回所属窗口', () => {
      manager.attach(win, input('t1'))
      viewOf(0).focused = true
      manager.release(win.id, 't1')
      expect(win.focuses).toBe(1)
      expect(viewOf(0).destroyed).toBe(true)
    })

    it('freeze：视图持有焦点时交回应用界面（隐藏的视图拿不住焦点，按键会无处可去）并报告 yielded', async () => {
      manager.attach(win, input('t1'))
      const v = viewOf(0)
      v.focused = true
      expect(await manager.freeze(win.id, 't1')).toEqual({
        image: 'data:image/png;base64,AAAA',
        yielded: true
      })
      expect(win.focuses).toBe(1)
      expect(v.visible).toBe(false)
    })

    it('unfreeze：refocus 为真时把焦点还给视图，为假时不动（渲染端判断用户是否已在应用中操作）', async () => {
      manager.attach(win, input('t1'))
      const v = viewOf(0)
      v.focused = true
      await manager.freeze(win.id, 't1')
      v.focused = false
      manager.unfreeze(win.id, 't1', false)
      expect(v.visible).toBe(true)
      expect(v.focused).toBe(false)

      await manager.freeze(win.id, 't1')
      manager.unfreeze(win.id, 't1', true)
      expect(v.focused).toBe(true)
    })

    it('截图期间被隐藏的视图：unfreeze 不还焦点', async () => {
      manager.attach(win, input('t1'))
      await manager.freeze(win.id, 't1')
      manager.hide(win.id, 't1')
      manager.unfreeze(win.id, 't1', true)
      expect(viewOf(0).focused).toBe(false)
    })

    it('已在截图中再次 freeze：不再截图，返回空图', async () => {
      manager.attach(win, input('t1'))
      const v = viewOf(0)
      const capture = vi.spyOn(v.webContents, 'capturePage')
      await manager.freeze(win.id, 't1')
      expect(await manager.freeze(win.id, 't1')).toEqual({ image: '', yielded: false })
      expect(capture).toHaveBeenCalledTimes(1)
    })

    it('没有焦点时 freeze 不移动焦点（yielded 为假）', async () => {
      manager.attach(win, input('t1'))
      expect(await manager.freeze(win.id, 't1')).toMatchObject({ yielded: false })
      manager.unfreeze(win.id, 't1', false)
      expect(win.focuses).toBe(0)
      expect(viewOf(0).focused).toBe(false)
    })
  })

  describe('键盘焦点：应用界面操作 attach 之后，视图不经用户点击拿不走焦点（资源树键盘浏览，Q18）', () => {
    /** 视图拿到焦点（webContents 的 focus 事件） */
    const gainFocus = (v: FakeView): void => {
      v.focused = true
      v.events.focused()
    }

    it('新建视图加载时拿到焦点 → 交回应用界面', () => {
      manager.attach(win, input('t1'))
      gainFocus(viewOf(0))
      expect(win.focuses).toBe(1)
    })

    it('复用视图加载新地址（或再次显示）时拿到焦点 → 交回应用界面', () => {
      manager.attach(win, input('t1'))
      manager.hide(win.id, 't1')
      manager.attach(win, input('t1', 'second.html'))
      gainFocus(viewOf(0))
      expect(win.focuses).toBe(1)
      // 焦点已在应用界面（假对象不联动）
      viewOf(0).focused = false
      manager.hide(win.id, 't1')
      manager.attach(win, input('t1', 'second.html'))
      gainFocus(viewOf(0))
      expect(win.focuses).toBe(2)
    })

    it('用户在视图内按下鼠标之后拿到焦点 → 不动；焦点先被交回时按下鼠标把焦点给视图', () => {
      manager.attach(win, input('t1'))
      const v = viewOf(0)
      v.events.pointerDown()
      // 按下鼠标时视图还没有焦点：给视图（焦点事件与鼠标事件的先后不确定）
      expect(v.focused).toBe(true)
      v.events.focused()
      expect(win.focuses).toBe(0)

      manager.attach(win, input('t2', 'b.html'))
      const w = viewOf(1)
      gainFocus(w)
      expect(win.focuses).toBe(1)
      w.focused = false
      w.events.pointerDown()
      expect(w.focused).toBe(true)
      w.events.focused()
      expect(win.focuses).toBe(1)
    })

    it('attach 时视图已持有焦点（在页面中点链接 / 按 Alt+←）→ 加载后的焦点不交回', () => {
      manager.attach(win, input('t1'))
      const v = viewOf(0)
      v.events.pointerDown()
      manager.attach(win, input('t1', 'second.html'))
      v.events.focused()
      expect(win.focuses).toBe(0)
    })

    it('unfreeze 还给视图的焦点不交回', async () => {
      manager.attach(win, input('t1'))
      const v = viewOf(0)
      v.events.pointerDown()
      await manager.freeze(win.id, 't1')
      expect(win.focuses).toBe(1)
      v.focused = false
      manager.unfreeze(win.id, 't1', true)
      v.events.focused()
      expect(v.focused).toBe(true)
      expect(win.focuses).toBe(1)
    })

    describe('焦点在页面中导航（点链接 / 页面内 Alt+←→）：同一标签紧接着的 attach 把焦点给视图', () => {
      /** 用户点击页面（焦点进入视图） */
      const clickView = (v: FakeView): void => v.events.pointerDown()
      /** 交回应用界面后视图失去焦点（假对象不联动） */
      const yielded = (v: FakeView): void => {
        v.focused = false
      }

      it('hide 时视图持有焦点 → 同标签再 attach（复用视图加载新页面）：focus 视图，加载时拿到的焦点不交回', () => {
        manager.attach(win, input('t1'))
        const v = viewOf(0)
        clickView(v)
        manager.hide(win.id, 't1')
        expect(win.focuses).toBe(1)
        yielded(v)
        manager.attach(win, input('t1', 'second.html'))
        expect(v.focused).toBe(true)
        v.events.focused()
        expect(win.focuses).toBe(1)
      })

      it('release 时视图持有焦点（查看器不同）→ 同标签 attach 新建的视图：focus 新视图，不交回', () => {
        manager.attach(win, input('t1'))
        const v = viewOf(0)
        clickView(v)
        manager.release(win.id, 't1')
        yielded(v)
        manager.attach(win, input('t1', 'notes.md', { view: 'markdown' }))
        const w = viewOf(1)
        expect(w.focused).toBe(true)
        w.events.focused()
        expect(win.focuses).toBe(1)
      })

      it('只沿用一次：之后的 attach 维持现状（视图不经点击拿到的焦点交回）', () => {
        manager.attach(win, input('t1'))
        const v = viewOf(0)
        clickView(v)
        manager.hide(win.id, 't1')
        yielded(v)
        manager.attach(win, input('t1', 'second.html'))
        // 用户随后点击应用界面（焦点离开视图），切到别处再回来
        yielded(v)
        manager.hide(win.id, 't1')
        manager.attach(win, input('t1'))
        expect(v.focused).toBe(false)
        gainFocus(v)
        expect(win.focuses).toBe(2)
      })

      it('交回之后用户在应用界面中按键 / 按下鼠标（例如回到文本文件后在应用中按 Alt+→）→ 维持现状', () => {
        manager.attach(win, input('t1'))
        const v = viewOf(0)
        clickView(v)
        manager.release(win.id, 't1')
        yielded(v)
        manager.appInput(2) // 其他窗口的操作不影响本窗口
        manager.appInput(win.id)
        manager.attach(win, input('t1'))
        const w = viewOf(1)
        expect(w.focused).toBe(false)
        gainFocus(w)
        expect(win.focuses).toBe(2)
      })

      it('紧接着 attach 的是其他标签（页面中按 Ctrl+Tab 等）→ 两个标签都维持现状', () => {
        manager.attach(win, input('t1'))
        manager.attach(win, input('t2', 'b.html'))
        manager.hide(win.id, 't2')
        const v = viewOf(0)
        clickView(v)
        manager.hide(win.id, 't1')
        yielded(v)
        manager.attach(win, input('t2', 'b.html'))
        expect(viewOf(1).focused).toBe(false)
        manager.hide(win.id, 't2')
        manager.attach(win, input('t1'))
        expect(v.focused).toBe(false)
      })

      it('窗口的视图全部销毁（渲染端重新加载）后不沿用', () => {
        manager.attach(win, input('t1'))
        const v = viewOf(0)
        clickView(v)
        manager.hide(win.id, 't1')
        yielded(v)
        manager.disposeWindow(win.id)
        manager.attach(win, input('t1'))
        expect(viewOf(1).focused).toBe(false)
      })
    })

    it('隐藏中 / 已销毁的视图的焦点事件不处理', () => {
      manager.attach(win, input('t1'))
      manager.hide(win.id, 't1')
      gainFocus(viewOf(0))
      expect(win.focuses).toBe(0)
      manager.release(win.id, 't1')
      viewOf(0).events.focused()
      viewOf(0).events.pointerDown()
      expect(win.focuses).toBe(1) // release 时视图持有焦点 → 交回一次
    })
  })

  it('截图期间被隐藏的视图，unfreeze 不再显示它；截图中的视图不参与淘汰', async () => {
    manager.attach(win, input('t1'))
    await manager.freeze(win.id, 't1')
    manager.hide(win.id, 't1')
    manager.unfreeze(win.id, 't1', false)
    expect(viewOf(0).visible).toBe(false)

    manager.attach(win, input('t2'))
    await manager.freeze(win.id, 't2')
    for (let i = 3; i <= WEB_VIEW_LIMIT + 1; i++) {
      manager.attach(win, input(`t${i}`))
      manager.hide(win.id, `t${i}`)
    }
    expect(viewOf(0).destroyed).toBe(true) // t1：隐藏中、最久未显示
    expect(viewOf(1).destroyed).toBe(false) // t2：截图中（逻辑上仍显示）
  })

  describe('视图事件 → 发给所属窗口', () => {
    let events: ViewEvents
    const scopeIdOfView = (): string => new URL(viewOf(0).loads[0]!).hostname

    beforeEach(() => {
      manager.attach(win, input('t1'))
      events = viewOf(0).events
      send.mockClear()
    })

    it('导航到同范围 → web.navigate（newTab 透传；查询与片段放在 fragment）', () => {
      events.navigate(`pch-web://${scopeIdOfView()}/second.html#sec`, false)
      events.navigate(`pch-web://${scopeIdOfView()}/third.html`, true)
      expect(send.mock.calls).toEqual([
        [
          1,
          'web.navigate',
          { tabId: 't1', uri: `${ROOT}/second.html`, newTab: false, fragment: '#sec' }
        ],
        [1, 'web.navigate', { tabId: 't1', uri: `${ROOT}/third.html`, newTab: true, fragment: '' }]
      ])
    })

    it('范围外 → web.notice outOfScope；外部 → openExternal，不发事件', () => {
      const openExternal = vi.fn()
      const m = new WebViewManager({
        createView: (ev) => {
          const v = new FakeView(ev)
          views.push(v)
          return v
        },
        send,
        scopes,
        openExternal,
        logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() }
      })
      m.attach(win, input('x'))
      const ev = views.at(-1)!.events
      send.mockClear()
      ev.navigate('file:///C:/Windows/win.ini', false)
      ev.navigate('https://example.com/', true)
      ev.navigate('javascript:alert(1)', false)
      expect(send.mock.calls).toEqual([
        [1, 'web.notice', { tabId: 'x', notice: 'outOfScope' }],
        [1, 'web.notice', { tabId: 'x', notice: 'unsupported' }]
      ])
      expect(openExternal).toHaveBeenCalledWith('https://example.com/')
    })

    it('外部链接：同一视图 2 秒内最多交给系统一次（页面脚本 / meta refresh 无手势也能触发），超出丢弃并记日志', () => {
      const openExternal = vi.fn()
      const warn = vi.fn()
      let now = 10_000
      const m = new WebViewManager({
        createView: (ev) => {
          const v = new FakeView(ev)
          views.push(v)
          return v
        },
        send,
        scopes,
        openExternal,
        logger: { warn, error: vi.fn(), info: vi.fn(), debug: vi.fn() },
        now: () => now
      })
      m.attach(win, input('a'))
      const a = views.at(-1)!.events
      m.attach(win, input('b'))
      const b = views.at(-1)!.events
      a.navigate('https://example.com/1', false)
      now += 1999
      a.navigate('https://example.com/2', true)
      // 其他视图不受影响
      b.navigate('https://example.com/b', false)
      expect(openExternal.mock.calls).toEqual([
        ['https://example.com/1'],
        ['https://example.com/b']
      ])
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('https://example.com/2'))
      now += 1
      a.navigate('https://example.com/3', false)
      expect(openExternal).toHaveBeenLastCalledWith('https://example.com/3')
    })

    it('应用快捷键 → web.shortcut 并返回 true；其他按键返回 false', () => {
      const base = { type: 'keyDown', shift: false, alt: false, meta: false, isComposing: false }
      expect(events.key({ ...base, key: 'w', control: true })).toBe(true)
      expect(events.key({ ...base, key: 's', control: true })).toBe(false)
      expect(send.mock.calls).toEqual([
        [1, 'web.shortcut', { tabId: 't1', key: 'w', ctrl: true, shift: false, alt: false }]
      ])
    })

    it('鼠标侧键 → web.shortcut Alt+←/→', () => {
      events.sideButton('back')
      events.sideButton('forward')
      expect(send.mock.calls).toEqual([
        [
          1,
          'web.shortcut',
          { tabId: 't1', key: 'ArrowLeft', ctrl: false, shift: false, alt: true }
        ],
        [
          1,
          'web.shortcut',
          { tabId: 't1', key: 'ArrowRight', ctrl: false, shift: false, alt: true }
        ]
      ])
    })

    it('加载状态、标题、失败 → web.state（累积）', () => {
      events.loadingChanged(true)
      events.titleChanged('Proto')
      events.loadFailed('ERR_FILE_NOT_FOUND')
      events.loadingChanged(false)
      events.loadingChanged(true) // 重新加载：清除失败
      expect(send.mock.calls.map((c) => c[2])).toEqual([
        { tabId: 't1', title: '', loading: true, failed: null },
        { tabId: 't1', title: 'Proto', loading: true, failed: null },
        { tabId: 't1', title: 'Proto', loading: true, failed: 'ERR_FILE_NOT_FOUND' },
        { tabId: 't1', title: 'Proto', loading: false, failed: 'ERR_FILE_NOT_FOUND' },
        { tabId: 't1', title: 'Proto', loading: true, failed: null }
      ])
      expect(send.mock.calls.every((c) => c[0] === 1 && c[1] === 'web.state')).toBe(true)
    })

    it('下载 → web.notice download（按 webContents id 找到所属视图）', () => {
      manager.notifyContents(viewOf(0).webContents.id, 'download')
      manager.notifyContents(9999, 'download')
      expect(send.mock.calls).toEqual([[1, 'web.notice', { tabId: 't1', notice: 'download' }]])
    })

    it('销毁后的视图事件不再发送', () => {
      manager.release(win.id, 't1')
      events.loadingChanged(true)
      events.navigate(`pch-web://${scopeIdOfView()}/x.html`, false)
      expect(send).not.toHaveBeenCalled()
    })
  })
})
