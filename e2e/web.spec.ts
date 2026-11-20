import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { data, launchFast, removeDirs, toggleRow } from './support'

/** 40×30 的红色 PNG */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAACgAAAAeCAIAAADRv8uKAAAAK0lEQVR4nO3NMQ0AAAgDsCmZf1GIQQYcTfo3056IWCwWi8VisVgsFov/xgsV3yDM1jw9QgAAAABJRU5ErkJggg==',
  'base64'
)

/** 一页、一行文字的最小 PDF（xref 偏移按实际字节计算） */
function minimalPdf(text: string): Buffer {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${`BT /F1 18 Tf 24 72 Td (${text}) Tj ET`.length} >>\nstream\nBT /F1 18 Tf 24 72 Td (${text}) Tj ET\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  ]
  let body = '%PDF-1.4\n'
  const offsets: number[] = []
  objects.forEach((o, i) => {
    offsets.push(Buffer.byteLength(body))
    body += `${i + 1} 0 obj\n${o}\nendobj\n`
  })
  const xref = Buffer.byteLength(body)
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const off of offsets) body += `${String(off).padStart(10, '0')} 00000 n \n`
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(body, 'latin1')
}

/**
 * 样本原型（proto/）：index.html 引用相对的 CSS / 图片 / 脚本（脚本把加载次数写入 localStorage 与页面），
 * 链接到同目录的 HTML、Markdown、外网、范围外的 file:、其他范围的 pch-web:
 */
function writeProto(project: string): void {
  const proto = path.join(project, 'proto')
  mkdirSync(path.join(proto, 'img'), { recursive: true })
  writeFileSync(
    path.join(proto, 'index.html'),
    `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Proto index</title>
<link rel="stylesheet" href="./style.css">
</head>
<body>
<h1 id="heading">原型</h1>
<img id="pic" src="./img/a.png" alt="">
<p>loads: <span id="counter">0</span></p>
<p>session: <span id="session">0</span></p>
<p><a id="to-second" href="./second.html">second</a></p>
<p><a id="to-notes" href="./notes.md">notes</a></p>
<p><a id="to-external" href="https://example.invalid/">external</a></p>
<p><a id="to-winini" href="file:///C:/Windows/win.ini">win.ini</a></p>
<p><a id="to-other-scope" href="pch-web://s0000000000000000/x.html">other scope</a></p>
<script src="./app.js"></script>
</body>
</html>
`
  )
  writeFileSync(
    path.join(proto, 'style.css'),
    'body { background: rgb(250, 240, 200); font: 16px sans-serif }\np { margin: 12px 0 }\n'
  )
  writeFileSync(
    path.join(proto, 'app.js'),
    `const loads = Number(localStorage.getItem('pch-e2e-loads') ?? '0') + 1
localStorage.setItem('pch-e2e-loads', String(loads))
document.getElementById('counter').textContent = String(loads)
// sessionStorage 按 webContents 隔离：同一个视图中的加载次数
const session = Number(sessionStorage.getItem('pch-e2e-session') ?? '0') + 1
sessionStorage.setItem('pch-e2e-session', String(session))
document.getElementById('session').textContent = String(session)
`
  )
  writeFileSync(path.join(proto, 'img', 'a.png'), PNG)
  writeFileSync(
    path.join(proto, 'second.html'),
    `<!doctype html><title>Second page</title><p id="second">second</p>
<p>session: <span id="session"></span></p>
<script>document.getElementById('session').textContent = sessionStorage.getItem('pch-e2e-session')</script>
`
  )
  writeFileSync(path.join(proto, 'notes.md'), '# Notes\n\nhello\n')
}

test.describe('the browser view (html plugin)', () => {
  let userData: string
  let files: string
  let project: string

  test.beforeEach(() => {
    userData = mkdtempSync(path.join(tmpdir(), 'pch-e2e-'))
    files = mkdtempSync(path.join(tmpdir(), 'pch-e2e-files-'))
    project = path.join(files, '案件')
    mkdirSync(project, { recursive: true })
    writeFileSync(path.join(project, 'memo.txt'), 'memo')
    writeProto(project)
  })
  test.afterEach(() => {
    removeDirs(userData, files)
  })

  /** 界面语言 en，添加条目「案件」，记录 shell.openExternal 的调用（不打开系统浏览器），返回资源树 */
  async function setup(app: ElectronApplication, page: Page): Promise<Locator> {
    await data(page, 'settings.set', { 'general.language': 'en' })
    await expect(page.locator('html')).toHaveAttribute('lang', 'en')
    const { id: workspaceId } = await data(page, 'workspace.active')
    await data(page, 'entry.add', { kind: 'folder', workspaceId, parentId: null, path: project })
    await app.evaluate(({ shell }) => {
      const g = globalThis as { __pchExternal?: string[] }
      g.__pchExternal = []
      shell.openExternal = async (url: string) => {
        g.__pchExternal!.push(url)
      }
    })
    const tree = page.getByRole('tree')
    await expect(tree.getByRole('treeitem', { name: '案件' })).toBeVisible()
    return tree
  }

  const tabs = (page: Page): Locator => page.getByRole('tablist').getByRole('tab')
  const panel = (page: Page): Locator => page.getByRole('tabpanel')
  const placeholder = (page: Page): Locator => panel(page).locator('[data-web-view]')
  const statusLine = (page: Page): Locator => panel(page).locator('[data-status-bar]')
  const bar = (page: Page): Locator => page.getByRole('navigation', { name: 'Address bar' })

  /** 浏览器视图的页面（台账 S1：按 URL 在 electronApp.windows() 中找；已关闭的除外） */
  async function viewPage(app: ElectronApplication, suffix: string): Promise<Page> {
    let found: Page | undefined
    await expect
      .poll(() => {
        found = app
          .windows()
          .find((p) => !p.isClosed() && p.url().startsWith('pch-web:') && p.url().endsWith(suffix))
        return found !== undefined
      })
      .toBe(true)
    return found!
  }

  /** 主进程中本窗口的浏览器视图（WebContentsView）：URL、是否显示、位置 */
  const mainViews = (
    app: ElectronApplication
  ): Promise<
    Array<{
      url: string
      visible: boolean
      bounds: { x: number; y: number; width: number; height: number }
    }>
  > =>
    app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]!.contentView.children.flatMap((v) => {
        const url = (v as { webContents?: Electron.WebContents }).webContents?.getURL() ?? ''
        return url.startsWith('pch-web:')
          ? [{ url, visible: v.getVisible(), bounds: v.getBounds() }]
          : []
      })
    )
  const visibility = async (app: ElectronApplication): Promise<boolean[]> =>
    (await mainViews(app)).map((v) => v.visible)
  /** 主进程中浏览器视图的 webContents id（同一个 id = 同一个视图被复用） */
  const viewIds = (app: ElectronApplication): Promise<number[]> =>
    app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]!.contentView.children.flatMap((v) => {
        const wc = (v as { webContents?: Electron.WebContents }).webContents
        return wc?.getURL().startsWith('pch-web:') ? [wc.id] : []
      })
    )
  /** 键盘焦点：应用界面的 webContents / 各浏览器视图 */
  const focus = (app: ElectronApplication): Promise<{ app: boolean; views: boolean[] }> =>
    app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0]!
      return {
        app: win.webContents.isFocused(),
        views: win.contentView.children.flatMap((v) => {
          const wc = (v as { webContents?: Electron.WebContents }).webContents
          return wc?.getURL().startsWith('pch-web:') ? [wc.isFocused()] : []
        })
      }
    })

  /**
   * 在视图页面中求值（主进程 executeJavaScript）。主进程阻止了页面的导航（外部链接等）之后，
   * Playwright 认为该页面的导航一直未完成，之后对它的 locator / evaluate 都会等待（knowledge/testing.md），
   * 这类点击之后改用它读取页面
   */
  const evalIn = <T>(app: ElectronApplication, view: Page, expression: string): Promise<T> =>
    app.evaluate(
      ({ webContents }, [url, js]) =>
        webContents
          .getAllWebContents()
          .find((w) => w.getURL() === url)!
          .executeJavaScript(js),
      [view.url(), expression] as const
    ) as Promise<T>

  /** 在视图中真实点击元素中心（主进程 sendInputEvent；Playwright 的 click 在被阻止的导航上一直等待） */
  async function clickIn(app: ElectronApplication, view: Page, selector: string): Promise<void> {
    const point = await evalIn<{ x: number; y: number }>(
      app,
      view,
      `(() => {
        const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect()
        return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }
      })()`
    )
    await app.evaluate(
      ({ webContents }, [url, p]) => {
        const wc = webContents.getAllWebContents().find((w) => w.getURL() === url)!
        wc.sendInputEvent({ type: 'mouseDown', x: p.x, y: p.y, button: 'left', clickCount: 1 })
        wc.sendInputEvent({ type: 'mouseUp', x: p.x, y: p.y, button: 'left', clickCount: 1 })
      },
      [view.url(), point] as const
    )
  }

  /**
   * 键盘焦点移到视图中（窗口也置于前台：webContents.isFocused 以窗口持有系统焦点为前提）。
   * 先在页面左上角的空白处按下鼠标（用户点击视图）：没有点击时视图拿到的焦点由主进程交回应用界面（Q18）
   */
  async function focusView(app: ElectronApplication, view: Page): Promise<void> {
    await app.evaluate(({ BrowserWindow, webContents }, url) => {
      BrowserWindow.getAllWindows()[0]!.focus()
      const wc = webContents.getAllWebContents().find((w) => w.getURL() === url)!
      wc.sendInputEvent({ type: 'mouseDown', x: 2, y: 2, button: 'left', clickCount: 1 })
      wc.sendInputEvent({ type: 'mouseUp', x: 2, y: 2, button: 'left', clickCount: 1 })
      wc.focus()
    }, view.url())
  }

  /** 焦点在视图中时按键（rawKeyDown 经 before-input-event，与真实按键相同的路径） */
  async function pressIn(
    app: ElectronApplication,
    view: Page,
    keyCode: string,
    modifiers: Array<'control' | 'shift' | 'alt'> = []
  ): Promise<void> {
    await app.evaluate(
      ({ webContents }, [url, k, m]) => {
        const wc = webContents.getAllWebContents().find((w) => w.getURL() === url)!
        wc.focus()
        wc.sendInputEvent({ type: 'rawKeyDown', keyCode: k, modifiers: m })
        wc.sendInputEvent({ type: 'keyUp', keyCode: k, modifiers: m })
      },
      [view.url(), keyCode, modifiers] as const
    )
  }

  async function openIndex(app: ElectronApplication, page: Page, tree: Locator): Promise<Page> {
    await toggleRow(tree.getByRole('treeitem', { name: '案件' }))
    await toggleRow(tree.getByRole('treeitem', { name: 'proto' }))
    await tree.getByRole('treeitem', { name: 'index.html' }).click()
    await expect(tabs(page)).toHaveText(['index.html'])
    const view = await viewPage(app, '/proto/index.html')
    await expect(view.locator('#counter')).toHaveText('1')
    return view
  }

  test('shows a local prototype with its CSS, image and script; links go through the app; tab switches keep the page', async () => {
    const { app, page } = await launchFast(userData)
    try {
      const tree = await setup(app, page)
      let view = await openIndex(app, page, tree)

      // 相对路径的样式、图片、脚本都生效；状态行显示页面标题
      await expect
        .poll(() => view.evaluate(() => getComputedStyle(document.body).backgroundColor))
        .toBe('rgb(250, 240, 200)')
      await expect
        .poll(() =>
          view.evaluate(() => (document.getElementById('pic') as HTMLImageElement).naturalWidth)
        )
        .toBe(40)
      expect(await view.evaluate(() => localStorage.getItem('pch-e2e-loads'))).toBe('1')
      await expect(statusLine(page).locator('[data-page-title]')).toHaveText('Proto index')
      // 视图贴在占位元素上（DIP = CSS 像素，取整误差 ≤ 1）
      const box = (await placeholder(page).boundingBox())!
      await expect.poll(() => visibility(app)).toEqual([true])
      const [shown] = await mainViews(app)
      expect(Math.abs(shown!.bounds.x - box.x)).toBeLessThanOrEqual(1)
      expect(Math.abs(shown!.bounds.y - box.y)).toBeLessThanOrEqual(1)
      expect(Math.abs(shown!.bounds.width - box.width)).toBeLessThanOrEqual(1)
      expect(Math.abs(shown!.bounds.height - box.height)).toBeLessThanOrEqual(1)

      // 切到其他标签再回来：视图只隐藏，页面不重新加载（计数器不变）
      await tree.getByRole('treeitem', { name: 'memo.txt' }).click({ modifiers: ['Control'] })
      await expect(tabs(page)).toHaveText(['index.html', 'memo.txt'])
      await expect(tabs(page).nth(1)).toHaveAttribute('aria-selected', 'true')
      await expect.poll(() => visibility(app)).toEqual([false])
      await tabs(page).nth(0).click()
      await expect.poll(() => visibility(app)).toEqual([true])
      await expect(view.locator('#counter')).toHaveText('1')
      await expect(statusLine(page).locator('[data-page-title]')).toHaveText('Proto index')

      // 焦点在页面中按 F5：应用的刷新 → 视图重新加载
      await pressIn(app, view, 'F5')
      await expect(view.locator('#counter')).toHaveText('2')

      // 同范围的 HTML 链接：在本标签导航（进入历史），应用的「后退」回到 index。
      // 网页之间跳转复用同一个视图（同一个 webContents：sessionStorage 延续）
      await expect(view.locator('#session')).toHaveText('2')
      const [viewId] = await viewIds(app)
      await clickIn(app, view, '#to-second')
      await expect(tabs(page).nth(0)).toHaveText('second.html')
      await expect(bar(page).getByRole('listitem').last()).toHaveText('second.html')
      const second = await viewPage(app, '/proto/second.html')
      await expect(second.locator('#second')).toHaveText('second')
      await expect(second.locator('#session')).toHaveText('2')
      expect(await viewIds(app)).toEqual([viewId])
      await bar(page).getByRole('button', { name: 'Back', exact: true }).click()
      await expect(tabs(page).nth(0)).toHaveText('index.html')
      view = await viewPage(app, '/proto/index.html')
      await expect(view.locator('#counter')).toHaveText('3')
      await expect(view.locator('#session')).toHaveText('3')
      expect(await viewIds(app)).toEqual([viewId])

      // Markdown 链接：在本标签以 Markdown 查看器打开。查看器不同（所有者换为 markdown 插件）→ 旧视图销毁、新建视图
      await clickIn(app, view, '#to-notes')
      await expect(tabs(page).nth(0)).toHaveText('notes.md')
      const notes = await viewPage(app, '/proto/notes.md?pch-view=markdown')
      await expect(notes.locator('#content h1')).toHaveText('Notes')
      const notesIds = await viewIds(app)
      expect(notesIds).toHaveLength(1)
      expect(notesIds).not.toEqual([viewId])
      await bar(page).getByRole('button', { name: 'Back', exact: true }).click()
      view = await viewPage(app, '/proto/index.html')
      await expect(view.locator('#counter')).toHaveText('4')
      // 回到 HTML 同样是新的视图：sessionStorage 从头开始
      await expect(view.locator('#session')).toHaveText('1')
      const backIds = await viewIds(app)
      expect(backIds).toHaveLength(1)
      expect(backIds).not.toEqual(notesIds)

      // 外网链接：交给系统浏览器（已替换为记录），视图不离开
      await clickIn(app, view, '#to-external')
      await expect
        .poll(() => app.evaluate(() => (globalThis as { __pchExternal?: string[] }).__pchExternal))
        .toEqual(['https://example.invalid/'])
      expect((await mainViews(app)).map((v) => v.url)).toEqual([
        expect.stringMatching(/\/proto\/index\.html$/)
      ])
      await expect(tabs(page)).toHaveText(['index.html', 'memo.txt'])

      // 范围外的 file: 链接：Chromium 在渲染进程拦截（不触发导航事件），视图与标签都不变、读不到 win.ini
      await clickIn(app, view, '#to-winini')
      await page.waitForTimeout(500)
      expect((await mainViews(app)).map((v) => v.url)).toEqual([
        expect.stringMatching(/\/proto\/index\.html$/)
      ])
      expect(await evalIn(app, view, 'document.getElementById("heading").textContent')).toBe('原型')
      expect(await evalIn(app, view, 'document.body.innerText')).not.toContain('[fonts]')
      expect(app.windows().some((p) => p.url().startsWith('file:'))).toBe(false)
      await expect(tabs(page)).toHaveText(['index.html', 'memo.txt'])

      // 其他范围的 pch-web: 链接：阻止，状态行提示数秒
      await clickIn(app, view, '#to-other-scope')
      await expect(statusLine(page).getByRole('status')).toHaveText(
        "Files outside this folder can't be opened"
      )
      expect((await mainViews(app)).map((v) => v.url)).toEqual([
        expect.stringMatching(/\/proto\/index\.html$/)
      ])
      await expect(tabs(page)).toHaveText(['index.html', 'memo.txt'])
    } finally {
      await app.close()
    }
  })

  test('pages reached by links keep the scope (a file entry and its subdirectory); #fragments are carried; other scopes cannot be read', async () => {
    // Javadoc 式的文件条目：index.html → pkg/Class.html，子页面用 ../ 引用上一级的样式与页面
    const javadoc = path.join(files, 'javadoc')
    mkdirSync(path.join(javadoc, 'pkg'), { recursive: true })
    writeFileSync(
      path.join(javadoc, 'index.html'),
      `<!doctype html><html><head><meta charset="utf-8"><title>Javadoc index</title>
<link rel="stylesheet" href="stylesheet.css"></head>
<body><h1 id="top">Javadoc</h1>
<p><a id="to-class" href="pkg/Class.html">Class</a></p>
<p><a id="to-sec" href="pkg/Class.html#sec">Class#sec</a></p>
<img id="pic" src="pic.png" alt=""></body></html>
`
    )
    writeFileSync(path.join(javadoc, 'stylesheet.css'), 'body { background: rgb(200, 230, 250) }')
    writeFileSync(path.join(javadoc, 'pic.png'), PNG)
    writeFileSync(
      path.join(javadoc, 'pkg', 'Class.html'),
      `<!doctype html><html><head><meta charset="utf-8"><title>Class</title>
<link rel="stylesheet" href="../stylesheet.css"></head>
<body><h1 id="cls">Class</h1><p><a id="to-index" href="../index.html">index</a></p>
<div style="height: 3000px"></div><h2 id="sec">Section</h2></body></html>
`
    )
    const { app, page } = await launchFast(userData)
    try {
      const tree = await setup(app, page)
      const { id: workspaceId } = await data(page, 'workspace.active')
      await data(page, 'entry.add', {
        kind: 'file',
        workspaceId,
        parentId: null,
        path: path.join(javadoc, 'index.html')
      })
      await tree.getByRole('treeitem', { name: 'index.html' }).click()
      await expect(tabs(page)).toHaveText(['index.html'])
      const index = await viewPage(app, '/index.html')
      await expect(index.locator('#top')).toHaveText('Javadoc')
      const scope = new URL(index.url()).host
      const background = (view: Page): Promise<string> =>
        evalIn(app, view, 'getComputedStyle(document.body).backgroundColor')

      // 子目录的页面：范围不变（同一个源），../stylesheet.css 生效
      await clickIn(app, index, '#to-class')
      await expect(tabs(page)).toHaveText(['Class.html'])
      const cls = await viewPage(app, '/pkg/Class.html')
      expect(new URL(cls.url()).host).toBe(scope)
      await expect.poll(() => background(cls)).toBe('rgb(200, 230, 250)')

      // ../index.html 回到条目的 index.html（不是 pkg/index.html）
      await clickIn(app, cls, '#to-index')
      await expect(tabs(page)).toHaveText(['index.html'])
      const back = await viewPage(app, '/index.html')
      expect(new URL(back.url()).pathname).toBe('/index.html')
      await expect
        .poll(() => evalIn(app, back, 'document.getElementById("top")?.textContent'))
        .toBe('Javadoc')

      // 跨页链接的 #片段：标签的位置不含它，视图加载时带上并滚到锚点
      await clickIn(app, back, '#to-sec')
      await expect(tabs(page)).toHaveText(['Class.html'])
      await expect(bar(page).getByRole('listitem').last()).toHaveText('Class.html')
      const sec = await viewPage(app, '/pkg/Class.html#sec')
      await expect.poll(() => evalIn(app, sec, 'location.hash')).toBe('#sec')
      await expect
        .poll(() =>
          evalIn(
            app,
            sec,
            '(() => { const r = document.getElementById("sec").getBoundingClientRect(); return scrollY > 0 && r.top >= 0 && r.top < innerHeight })()'
          )
        )
        .toBe(true)

      // 其他已登记范围（案件 条目）的资源：同范围的图片可读，其他范围的 fetch / 图片都失败（发起方检查）
      await toggleRow(tree.getByRole('treeitem', { name: '案件' }))
      await toggleRow(tree.getByRole('treeitem', { name: 'proto' }))
      // 案件/proto/index.html（第 3 层；第 1 层的 index.html 是文件条目）
      await tree
        .locator('[role="treeitem"][aria-level="3"]', { hasText: 'index.html' })
        .click({ modifiers: ['Control'] })
      const proto = await viewPage(app, '/proto/index.html')
      const other = new URL(proto.url()).host
      expect(other).not.toBe(scope)
      const loadImage = (src: string): string =>
        `new Promise((r) => { const i = new Image(); i.onload = () => r('load'); i.onerror = () => r('error'); i.src = ${JSON.stringify(src)} })`
      expect(await evalIn(app, sec, loadImage(`pch-web://${scope}/pic.png`))).toBe('load')
      expect(await evalIn(app, sec, loadImage(`pch-web://${other}/proto/img/a.png`))).toBe('error')
      expect(
        await evalIn(
          app,
          sec,
          `fetch('pch-web://${other}/proto/index.html').then((r) => String(r.status), () => 'failed')`
        )
      ).toMatch(/^(failed|403)$/)
    } finally {
      await app.close()
    }
  })

  test('popups and toasts swap the view for a screenshot; Ctrl+W in the page closes the tab', async () => {
    const { app, page } = await launchFast(userData)
    try {
      const tree = await setup(app, page)
      const view = await openIndex(app, page, tree)
      await expect.poll(() => visibility(app)).toEqual([true])

      // 地址栏的查看器下拉：视图隐藏，占位元素显示截图；关闭后恢复。
      // 焦点在页面中时：弹出层需要键盘，焦点交回应用界面；关闭后不还给视图
      await focusView(app, view)
      await expect.poll(() => focus(app)).toEqual({ app: false, views: [true] })
      await bar(page).getByRole('button', { name: 'View as', exact: true }).click()
      await expect(page.getByRole('menu')).toBeVisible()
      await expect(page.getByRole('menuitemradio', { name: 'Browser view' })).toHaveAttribute(
        'aria-checked',
        'true'
      )
      await expect.poll(() => visibility(app)).toEqual([false])
      await expect
        .poll(() => placeholder(page).evaluate((el) => el.style.backgroundImage))
        .toMatch(/^url\("data:image\/png;base64,/)
      await page.keyboard.press('Escape')
      await expect(page.getByRole('menu')).toHaveCount(0)
      await expect.poll(() => visibility(app)).toEqual([true])
      expect(await placeholder(page).evaluate((el) => el.style.backgroundImage)).toBe('')
      await expect(view.locator('#counter')).toHaveText('1')
      expect(await focus(app)).toEqual({ app: true, views: [false] })

      // toast（Ctrl+K「即将推出」）：截图态；点击预览区 → toast 收进状态栏，视图恢复（点击不转发给页面）
      // 焦点在页面中时：隐藏的视图拿不住焦点，截图期间焦点在应用界面（应用中没有焦点元素）；
      // 期间没有在应用中操作 → 结束后焦点回到页面
      await page.locator('body').click({ position: { x: 5, y: 5 } })
      await focusView(app, view)
      await expect.poll(() => focus(app)).toEqual({ app: false, views: [true] })
      await page.keyboard.press('Control+k')
      const toast = page.locator('[data-sonner-toast]')
      await expect(toast).toHaveCount(1)
      await expect.poll(() => visibility(app)).toEqual([false])
      await expect.poll(() => focus(app)).toEqual({ app: true, views: [false] })
      expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true)
      await placeholder(page).click()
      await expect(toast).toHaveCount(0)
      await expect(page.getByRole('button', { name: '1 notifications' })).toBeVisible()
      await expect.poll(() => visibility(app)).toEqual([true])
      expect(await placeholder(page).evaluate((el) => el.style.backgroundImage)).toBe('')
      await expect.poll(() => focus(app)).toEqual({ app: false, views: [true] })

      // 焦点在页面中按 Ctrl+W：关闭标签，视图销毁
      await pressIn(app, view, 'W', ['control'])
      await expect(tabs(page)).toHaveCount(0)
      await expect.poll(async () => (await mainViews(app)).length).toBe(0)
    } finally {
      await app.close()
    }
  })

  test('when the view hides, the keyboard focus returns to the app (Alt+← from the page, then Alt+→ without a click)', async () => {
    const { app, page } = await launchFast(userData)
    try {
      const tree = await setup(app, page)
      await toggleRow(tree.getByRole('treeitem', { name: '案件' }))
      await tree.getByRole('treeitem', { name: 'memo.txt' }).click()
      await expect(panel(page).getByRole('region', { name: 'File content' })).toContainText('memo')
      await toggleRow(tree.getByRole('treeitem', { name: 'proto' }))
      await tree.getByRole('treeitem', { name: 'index.html' }).click()
      const view = await viewPage(app, '/proto/index.html')
      await expect(view.locator('#counter')).toHaveText('1')
      // 前提：焦点在页面中，应用界面没有焦点
      await focusView(app, view)
      await expect.poll(() => focus(app)).toEqual({ app: false, views: [true] })

      // 焦点在页面中按 Alt+←：回到文本文件（当前位置不再用网页查看器 → 视图销毁），焦点交回应用界面
      await pressIn(app, view, 'Left', ['alt'])
      await expect(tabs(page)).toHaveText(['memo.txt'])
      await expect.poll(() => focus(app)).toEqual({ app: true, views: [] })
      // 不点击直接按 Alt+→（应用界面收到按键）：回到页面（新的视图）
      await page.keyboard.press('Alt+ArrowRight')
      await expect(tabs(page)).toHaveText(['index.html'])
      const again = await viewPage(app, '/proto/index.html')
      await expect(again.locator('#counter')).toHaveText('2')
      await expect.poll(() => visibility(app)).toEqual([true])
    } finally {
      await app.close()
    }
  })

  test('keyboard browsing in the tree keeps the focus in the tree when it passes web pages; a click in the page moves it there', async () => {
    const { app, page } = await launchFast(userData)
    try {
      const tree = await setup(app, page)
      await toggleRow(tree.getByRole('treeitem', { name: '案件' }))
      await toggleRow(tree.getByRole('treeitem', { name: 'proto' }))
      await tree.getByRole('treeitem', { name: 'app.js' }).click()
      await expect(tabs(page)).toHaveText(['app.js'])
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.focus())
      await expect.poll(() => focus(app)).toEqual({ app: true, views: [] })

      // ↓ → index.html：在当前标签以浏览器视图打开，视图加载后焦点仍在应用界面（资源树）
      await page.keyboard.press('ArrowDown')
      await expect(tabs(page)).toHaveText(['index.html'])
      const view = await viewPage(app, '/proto/index.html')
      await expect(view.locator('#counter')).toHaveText('1')
      await expect.poll(() => visibility(app)).toEqual([true])
      // 视图拿走焦点（若发生）在加载期间：留出时间
      await page.waitForTimeout(500)
      expect(await focus(app)).toEqual({ app: true, views: [false] })
      // 资源树持有焦点（行以 aria-activedescendant 表示）
      await expect(tree).toBeFocused()
      await expect(tree.getByRole('treeitem', { name: 'index.html' })).toHaveAttribute(
        'aria-selected',
        'true'
      )

      // 再 ↓ → notes.md（Markdown 视图，新建）：同样留在资源树
      await page.keyboard.press('ArrowDown')
      await expect(tabs(page)).toHaveText(['notes.md'])
      const notes = await viewPage(app, '/proto/notes.md?pch-view=markdown')
      await expect(notes.locator('#content h1')).toHaveText('Notes')
      await page.waitForTimeout(500)
      expect(await focus(app)).toEqual({ app: true, views: [false] })
      // 资源树持有焦点（行以 aria-activedescendant 表示）
      await expect(tree).toBeFocused()
      await expect(tree.getByRole('treeitem', { name: 'notes.md' })).toHaveAttribute(
        'aria-selected',
        'true'
      )

      // 用户点击页面：焦点进入视图
      await clickIn(app, notes, '#content h1')
      await expect.poll(() => focus(app)).toEqual({ app: false, views: [true] })
    } finally {
      await app.close()
    }
  })

  test('Markdown renders in the browser view: GFM, footnotes, mermaid; scripts never run; links go through the app', async () => {
    const docs = path.join(project, 'docs')
    mkdirSync(path.join(docs, 'img'), { recursive: true })
    writeFileSync(path.join(docs, 'img', 'a.png'), PNG)
    writeFileSync(path.join(docs, 'spec.xlsx'), 'not a real workbook')
    writeFileSync(path.join(docs, 'other.md'), '# Other\n\nother page\n')
    // 同源的本地 HTML：若能在 Markdown 的 iframe 中运行，就能操作外壳页（parent.document）
    writeFileSync(
      path.join(docs, 'x.html'),
      "<!doctype html><script>parent.document.title = 'z'; parent.document.body.dataset.framed = '1'</script>\n"
    )
    writeFileSync(
      path.join(docs, 'README.md'),
      [
        '# 設計メモ',
        '',
        '| 項目 | 値 |',
        '| --- | --- |',
        '| 版 | 1.0 |',
        '',
        '![図](./img/a.png)',
        '',
        '本文[^1]',
        '',
        '```mermaid',
        'graph TD',
        '  A[開始] --> B[終了]',
        '```',
        '',
        '```mermaid',
        'this is not a diagram',
        '```',
        '',
        "<script>document.title='x'</script>",
        '',
        '<img id="evil" src="x" onerror="document.title=\'y\'">',
        '',
        '<iframe id="frame" src="./x.html"></iframe>',
        '',
        '- [仕様書](./spec.xlsx)',
        '- [その他](./other.md)',
        '',
        '[^1]: 注釈です',
        ''
      ].join('\n')
    )
    const { app, page } = await launchFast(userData)
    try {
      const tree = await setup(app, page)
      await toggleRow(tree.getByRole('treeitem', { name: '案件' }))
      await toggleRow(tree.getByRole('treeitem', { name: 'docs' }))
      await tree.getByRole('treeitem', { name: 'README.md' }).click()
      await expect(tabs(page)).toHaveText(['README.md'])
      // 视图加载 .md 本身的地址（带 ?pch-view=markdown：协议处理器返回外壳页）
      const view = await viewPage(app, '/docs/README.md?pch-view=markdown')
      await expect.poll(() => visibility(app)).toEqual([true])

      // GFM 表格与相对路径的图片
      await expect(view.locator('#content table td').nth(1)).toHaveText('1.0')
      await expect
        .poll(() =>
          view.evaluate(
            () => (document.querySelector('img[alt="図"]') as HTMLImageElement).naturalWidth
          )
        )
        .toBe(40)
      // mermaid：图生成 svg；无法解析的块显示错误与源码，不影响其他内容
      await expect(view.locator('#content .mermaid-diagram svg')).toHaveCount(1)
      await expect(view.locator('#content .mermaid-error pre')).toHaveText('this is not a diagram')

      // Markdown 中的脚本不执行（<script>、onerror=、iframe 中的同源 HTML）：标题是查看脚本设的第一个 h1
      await expect
        .poll(() =>
          view.evaluate(() => {
            const img = document.getElementById('evil') as HTMLImageElement | null
            return img !== null && img.complete
          })
        )
        .toBe(true)
      // iframe 的加载（若未被阻止）晚于标题的设置：留出时间
      await page.waitForTimeout(1000)
      expect(await view.title()).toBe('設計メモ')
      expect(await view.evaluate(() => document.body.dataset.framed ?? null)).toBeNull()
      await expect(statusLine(page).locator('[data-page-title]')).toHaveText('設計メモ')
      // 没有「システムのブラウザーで開く」
      await expect(statusLine(page).getByRole('button')).toHaveCount(0)

      // 脚注：链接与回跳都是页内锚点，页面自己处理（不经应用：标签与视图地址不变）
      await view.locator('a[href="#user-content-fn-1"]').click()
      await expect.poll(() => view.evaluate(() => location.hash)).toBe('#user-content-fn-1')
      await view.locator('a[data-footnote-backref]').click()
      await expect.poll(() => view.evaluate(() => location.hash)).toBe('#user-content-fnref-1')
      await expect(tabs(page)).toHaveText(['README.md'])
      expect((await mainViews(app)).map((v) => v.url)).toEqual([
        expect.stringMatching(/\/docs\/README\.md\?pch-view=markdown#user-content-fnref-1$/)
      ])

      // 到其他 .md 的链接：本标签以 Markdown 打开（同一个视图）
      const [viewId] = await viewIds(app)
      await clickIn(app, view, 'a[href="./other.md"]')
      await expect(tabs(page)).toHaveText(['other.md'])
      const other = await viewPage(app, '/docs/other.md?pch-view=markdown')
      await expect(other.locator('#content h1')).toHaveText('Other')
      expect(await viewIds(app)).toEqual([viewId])

      // 回到 README，查看器下拉切到「Text」：显示源码，视图销毁（当前位置不再用网页查看器）
      await bar(page).getByRole('button', { name: 'Back', exact: true }).click()
      await expect(tabs(page)).toHaveText(['README.md'])
      await viewPage(app, '/docs/README.md?pch-view=markdown')
      await bar(page).getByRole('button', { name: 'View as', exact: true }).click()
      await expect(page.getByRole('menuitemradio')).toHaveText(['Markdown', 'Text', 'File info'])
      await page.getByRole('menuitemradio', { name: 'Text' }).click()
      await expect(panel(page).getByRole('region', { name: 'File content' })).toContainText(
        '# 設計メモ'
      )
      await expect.poll(async () => (await mainViews(app)).length).toBe(0)
    } finally {
      await app.close()
    }
  })

  test('images and PDFs open in the browser view', async () => {
    const media = path.join(project, 'media')
    mkdirSync(media)
    writeFileSync(
      path.join(media, 'diagram.svg'),
      '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><rect id="box" width="120" height="80" fill="rgb(30, 90, 200)"/></svg>\n'
    )
    writeFileSync(path.join(media, 'spec.pdf'), minimalPdf('PremiumCowHorse PDF'))
    const { app, page } = await launchFast(userData)
    try {
      const tree = await setup(app, page)
      await toggleRow(tree.getByRole('treeitem', { name: '案件' }))
      await toggleRow(tree.getByRole('treeitem', { name: 'media' }))

      await tree.getByRole('treeitem', { name: 'diagram.svg' }).click()
      const svg = await viewPage(app, '/media/diagram.svg')
      await expect.poll(() => svg.evaluate(() => document.documentElement.localName)).toBe('svg')
      await expect(svg.locator('#box')).toHaveAttribute('fill', 'rgb(30, 90, 200)')

      await tree.getByRole('treeitem', { name: 'spec.pdf' }).click()
      const pdf = await viewPage(app, '/media/spec.pdf')
      await expect.poll(() => pdf.evaluate(() => document.contentType)).toBe('application/pdf')
      await expect.poll(() => visibility(app)).toEqual([true])
      // 查看器可切换为文件信息（候选：浏览器显示 + 文本 + 文件信息）
      await bar(page).getByRole('button', { name: 'View as', exact: true }).click()
      await expect(page.getByRole('menuitemradio')).toHaveText([
        'Browser view',
        'Text',
        'File info'
      ])
      await page.keyboard.press('Escape')
    } finally {
      await app.close()
    }
  })
})
