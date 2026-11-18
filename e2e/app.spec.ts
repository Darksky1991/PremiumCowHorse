import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
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
