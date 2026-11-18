import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page
} from '@playwright/test'

const appDir = path.resolve(__dirname, '../apps/desktop')

async function launch(userDataDir: string): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    args: [appDir],
    env: { ...process.env, PCH_USER_DATA_DIR: userDataDir, ELECTRON_RENDERER_URL: '' }
  })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  return { app, page }
}

test.describe('first screen', () => {
  let userData: string

  test.beforeEach(() => {
    userData = mkdtempSync(path.join(tmpdir(), 'pch-e2e-'))
  })
  test.afterEach(() => {
    rmSync(userData, { recursive: true, force: true })
  })

  test('boots from app:// and renders the shell', async () => {
    const { app, page } = await launch(userData)
    try {
      expect(page.url()).toBe('app://renderer/')
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
      await expect(page.getByRole('banner')).toContainText('PremiumCowHorse')
      await expect(page.getByRole('contentinfo')).toContainText('v0.1.0')
      // 外壳布局必须撑满窗口：状态栏贴着视口底部
      const layout = await page.evaluate(() => ({
        footerBottom: document.querySelector('footer')!.getBoundingClientRect().bottom,
        viewport: window.innerHeight
      }))
      expect(layout.footerBottom).toBe(layout.viewport)
      await page.screenshot({ path: 'test-results/first-screen.png' })
    } finally {
      await app.close()
    }
  })

  test('renderer is sandboxed and only sees the whitelisted bridge', async () => {
    const { app, page } = await launch(userData)
    try {
      const surface = await page.evaluate(() => ({
        bridge: Object.keys(window.pch ?? {}).sort(),
        hasRequire: typeof (window as { require?: unknown }).require !== 'undefined',
        hasProcess: typeof (window as { process?: unknown }).process !== 'undefined'
      }))
      expect(surface).toEqual({
        bridge: ['bootstrap', 'getPathForFile', 'invoke', 'on'],
        hasRequire: false,
        hasProcess: false
      })

      // 首帧防闪烁依赖 bootstrap：sandbox preload 中解码失败会静默变成 null
      const bootstrap = await page.evaluate(() => window.pch!.bootstrap)
      expect(bootstrap).toMatchObject({
        platform: process.platform,
        theme: expect.stringMatching(/^(light|dark)$/)
      })
      expect(bootstrap?.windowId).toMatch(/^[0-9a-f-]{36}$/)

      const results = await page.evaluate(async () => ({
        unknown: await window.pch!.invoke('fs.deleteEverything', {}),
        badInput: await window.pch!.invoke('settings.set', { 'appearance.themeMode': 'purple' })
      }))
      expect(results.unknown).toMatchObject({ ok: false, error: { code: 'IPC_UNKNOWN_CHANNEL' } })
      expect(results.badInput).toMatchObject({ ok: false, error: { code: 'IPC_BAD_INPUT' } })

      // CSP 不允许内联脚本
      const csp = await page
        .locator('meta[http-equiv="Content-Security-Policy"]')
        .getAttribute('content')
      expect(csp).toContain("script-src 'self';")
      expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/)
    } finally {
      await app.close()
    }
  })

  test('renderer errors are written to main.log', async () => {
    const { app, page } = await launch(userData)
    try {
      await page.evaluate(() => {
        // 模拟事件回调中未捕获的 Promise 异常
        void Promise.reject(new Error('e2e-unhandled-marker'))
      })
      const log = path.join(userData, 'logs', 'main.log')
      await expect
        .poll(() => (existsSync(log) ? readFileSync(log, 'utf8') : ''), { timeout: 5000 })
        .toContain('e2e-unhandled-marker')
    } finally {
      await app.close()
    }
  })

  test('theme and language changes apply immediately and persist across restarts', async () => {
    let { app, page } = await launch(userData)
    try {
      await page.getByRole('button', { name: /テーマ|主题|Theme/ }).click()
      await page.getByRole('menuitemradio', { name: /ダーク|深色|Dark/ }).click()
      await expect(page.locator('html')).toHaveClass(/dark/)
      // Base UI 的单选菜单项默认选中后不关闭菜单（closeOnClick=false），用 Esc 关闭
      await page.keyboard.press('Escape')

      await page.getByRole('button', { name: /言語|语言|Language/ }).click()
      await page.getByRole('menuitemradio', { name: 'English' }).click()
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Default')
      await expect(page.locator('html')).toHaveAttribute('lang', 'en')
    } finally {
      await app.close()
    }

    ;({ app, page } = await launch(userData))
    try {
      await expect(page.locator('html')).toHaveClass(/dark/)
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Default')
      expect(
        await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.getTitle())
      ).toBe('PremiumCowHorse')
      await page.screenshot({ path: 'test-results/first-screen-dark-en.png' })
    } finally {
      await app.close()
    }
  })

  test('Ctrl+B and the activity bar toggle the sidebar', async () => {
    const { app, page } = await launch(userData)
    try {
      const sidebar = page.locator('aside')
      await expect(sidebar).toBeVisible()
      await page.keyboard.press('Control+B')
      await expect(sidebar).toBeHidden()
      await page.getByRole('button', { name: /エクスプローラー|资源管理器|Explorer/ }).click()
      await expect(sidebar).toBeVisible()
    } finally {
      await app.close()
    }
  })

  test('custom window controls replace the native ones and work', async () => {
    const { app, page } = await launch(userData)
    const win = <T>(fn: (w: Electron.BrowserWindow) => T): Promise<T> =>
      app.evaluate(({ BrowserWindow }, f) => {
        const w = BrowserWindow.getAllWindows()[0]!
        return new Function('w', `return (${f})(w)`)(w)
      }, fn.toString())
    try {
      // 不使用 Window Controls Overlay，系统不再绘制原生按钮
      expect(await page.evaluate(() => navigator.windowControlsOverlay?.visible ?? false)).toBe(
        false
      )

      const maximize = page.getByRole('button', { name: /^(最大化|Maximize)$/ })
      await maximize.click()
      await expect.poll(() => win((w) => w.isMaximized())).toBe(true)
      const restore = page.getByRole('button', { name: /^(元に戻す|还原|Restore)$/ })
      await expect(restore).toBeVisible()
      await restore.click()
      await expect.poll(() => win((w) => w.isMaximized())).toBe(false)

      await page.getByRole('button', { name: /^(最小化|Minimize)$/ }).click()
      await expect.poll(() => win((w) => w.isMinimized())).toBe(true)
      await win((w) => w.restore())

      const closed = app.waitForEvent('close')
      await page.getByRole('button', { name: /^(閉じる|关闭|Close)$/ }).click()
      await closed
    } finally {
      await app.close().catch(() => undefined)
    }
  })
})

test.describe('workspace data layer over IPC', () => {
  let userData: string
  let files: string

  test.beforeEach(() => {
    userData = mkdtempSync(path.join(tmpdir(), 'pch-e2e-'))
    files = mkdtempSync(path.join(tmpdir(), 'pch-e2e-files-'))
    mkdirSync(path.join(files, '設計書'))
    writeFileSync(path.join(files, '設計書', '仕様.xlsx'), '')
  })
  test.afterEach(() => {
    rmSync(userData, { recursive: true, force: true })
    rmSync(files, { recursive: true, force: true })
  })

  type IpcResult = { ok: true; data: unknown } | { ok: false; error: { code: string } }
  type Named = { id: string; name: string; label: string; uri: string }

  /** 经 window.pch 调用主进程，返回 IpcResult */
  const invoke = (page: Page, channel: string, input?: unknown): Promise<IpcResult> =>
    page.evaluate(([c, i]) => window.pch!.invoke(c as string, i) as Promise<IpcResult>, [
      channel,
      input
    ] as const)
  /** 调用并断言成功，返回 data */
  const data = async <T = Named>(page: Page, channel: string, input?: unknown): Promise<T> => {
    const res = await invoke(page, channel, input)
    if (!res.ok) throw new Error(`${channel} failed: ${JSON.stringify(res)}`)
    return res.data as T
  }

  test('creates and activates a workspace, adds a folder entry, lists it and persists', async () => {
    let { app, page } = await launch(userData)
    let workspaceId: string
    try {
      const initial = await data<Named[]>(page, 'workspace.list')
      expect(initial.map((w) => w.id)).toEqual(['default'])

      const created = await data(page, 'workspace.create', { name: '案件A' })
      workspaceId = created.id
      await data(page, 'workspace.activate', { id: workspaceId })
      expect((await data(page, 'workspace.active')).name).toBe('案件A')

      const folder = path.join(files, '設計書')
      const entry = await data(page, 'entry.add', {
        kind: 'folder',
        workspaceId,
        parentId: null,
        path: folder
      })
      expect(entry).toMatchObject({ kind: 'folder', label: '設計書' })
      const entries = await data<Named[]>(page, 'entry.list', { workspaceId })
      expect(entries.map((e) => e.id)).toEqual([entry.id])

      const listed = await data<Named[]>(page, 'vfs.list', { uri: entry.uri, requestId: 'e2e-1' })
      expect(listed.map((f) => f.name)).toEqual(['仕様.xlsx'])

      const missing = await invoke(page, 'entry.add', {
        kind: 'folder',
        workspaceId,
        parentId: null,
        path: path.join(files, 'nope')
      })
      expect(missing).toMatchObject({ ok: false, error: { code: 'FS_NOT_FOUND' } })
    } finally {
      await app.close()
    }

    // 重启后：工作区、当前工作区与条目都还在
    ;({ app, page } = await launch(userData))
    try {
      expect((await data(page, 'workspace.active')).id).toBe(workspaceId)
      const entries = await data<Named[]>(page, 'entry.list', { workspaceId })
      expect(entries.map((e) => e.label)).toEqual(['設計書'])
    } finally {
      await app.close()
    }
  })

  test('explorer tree lists a folder entry lazily and supports keyboard expand / collapse', async () => {
    const { app, page } = await launch(userData)
    try {
      const { id: workspaceId } = await data(page, 'workspace.active')
      await data(page, 'entry.add', { kind: 'folder', workspaceId, parentId: null, path: files })

      const tree = page.getByRole('tree')
      const root = tree.getByRole('treeitem', { name: path.basename(files) })
      await expect(root).toHaveAttribute('aria-expanded', 'false')
      await expect(root).toHaveAttribute('aria-level', '1')

      // 点击可展开的行：选中并展开，真实子项懒加载
      await root.click()
      await expect(root).toHaveAttribute('aria-expanded', 'true')
      await expect(root).toHaveAttribute('aria-selected', 'true')
      const dir = tree.getByRole('treeitem', { name: '設計書' })
      await expect(dir).toHaveAttribute('aria-level', '2')

      // 键盘：↓ 选中子目录，→ 展开，← 折叠
      await page.keyboard.press('ArrowDown')
      await expect(dir).toHaveAttribute('aria-selected', 'true')
      await page.keyboard.press('ArrowRight')
      const file = tree.getByRole('treeitem', { name: '仕様.xlsx' })
      await expect(file).toHaveAttribute('aria-level', '3')
      await page.keyboard.press('ArrowLeft')
      await expect(file).toBeHidden()
      await expect(dir).toHaveAttribute('aria-expanded', 'false')
    } finally {
      await app.close()
    }
  })

  test('explorer tree shows an error row with retry for a folder that cannot be listed', async () => {
    const { app, page } = await launch(userData)
    try {
      const { id: workspaceId } = await data(page, 'workspace.active')
      const folder = path.join(files, '設計書')
      await data(page, 'entry.add', { kind: 'folder', workspaceId, parentId: null, path: folder })
      const root = page.getByRole('tree').getByRole('treeitem', { name: '設計書' })
      await expect(root).toBeVisible()

      // 添加后目录被移走：展开时列目录失败
      rmSync(folder, { recursive: true, force: true })
      await root.click()
      const retry = page.getByRole('button', { name: /^(再試行|重试|Retry)$/ })
      await expect(retry).toBeVisible()

      // 目录恢复后「重试」重新列出
      mkdirSync(folder)
      writeFileSync(path.join(folder, '復旧.txt'), '')
      await retry.click()
      await expect(page.getByRole('treeitem', { name: '復旧.txt' })).toBeVisible()
      await expect(retry).toBeHidden()
    } finally {
      await app.close()
    }
  })
})
