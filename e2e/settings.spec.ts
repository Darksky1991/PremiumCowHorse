import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { data, launch, removeDirs } from './support'

type Stored = Record<string, unknown>
const settingsOf = (page: Page): Promise<Stored> => data<Stored>(page, 'settings.getAll')

test.describe('settings page', () => {
  let userData: string
  test.beforeEach(() => {
    userData = mkdtempSync(path.join(tmpdir(), 'pch-e2e-'))
  })
  test.afterEach(() => {
    removeDirs(userData)
  })

  /** 日语界面下用活动栏齿轮打开设置页 */
  async function openSettings(page: Page): Promise<void> {
    await data(page, 'settings.set', { 'general.language': 'ja' })
    await expect(page.locator('html')).toHaveAttribute('lang', 'ja')
    await page.getByRole('button', { name: '設定', exact: true }).click()
    await expect(page.getByRole('tab', { name: '設定' })).toBeVisible()
    await expect(page.getByRole('navigation', { name: '設定の分類' })).toBeVisible()
  }

  const nav = (page: Page, name: string): Locator =>
    page.getByRole('navigation', { name: '設定の分類' }).getByRole('button', { name })

  test('the gear opens the page and a switch persists across a restart', async () => {
    let { app, page } = await launch(userData)
    try {
      await openSettings(page)
      await nav(page, 'エクスプローラー').click()
      const hidden = page.getByRole('switch', { name: '隠しファイルを表示' })
      await expect(hidden).not.toBeChecked()
      await hidden.click()
      await expect(hidden).toBeChecked()
      await expect.poll(async () => (await settingsOf(page))['explorer.showHiddenFiles']).toBe(true)
      await app.close()
      ;({ app, page } = await launch(userData))
      expect((await settingsOf(page))['explorer.showHiddenFiles']).toBe(true)
      await openSettings(page)
      await nav(page, 'エクスプローラー').click()
      await expect(page.getByRole('switch', { name: '隠しファイルを表示' })).toBeChecked()
    } finally {
      await app.close()
    }
  })

  test('an out-of-range number shows an error and is not submitted; restore default works', async () => {
    const { app, page } = await launch(userData)
    try {
      await openSettings(page)
      await nav(page, 'リモート接続').click()
      const input = page.getByRole('spinbutton', { name: 'キープアライブ間隔' })
      await expect(page.getByText('新しい接続から有効')).toBeVisible()

      await input.fill('4')
      await input.press('Enter')
      await expect(page.getByRole('alert')).toHaveText('5〜120 の範囲で入力してください')
      expect((await settingsOf(page))['remote.keepaliveSec']).toBe(15)

      await input.fill('30')
      await input.press('Enter')
      await expect.poll(async () => (await settingsOf(page))['remote.keepaliveSec']).toBe(30)
      const row = page.locator('[data-setting="remote.keepaliveSec"]')
      await row.getByRole('button', { name: '既定に戻す' }).click()
      await expect.poll(async () => (await settingsOf(page))['remote.keepaliveSec']).toBe(15)
      await expect(row.getByRole('button', { name: '既定に戻す' })).toHaveCount(0)
      await expect(input).toHaveValue('15')
    } finally {
      await app.close()
    }
  })

  test('choosing a color theme changes data-theme; search filters; about opens from the nav', async () => {
    const { app, page } = await launch(userData)
    try {
      await openSettings(page)
      await nav(page, '外観').click()
      await page.getByRole('button', { name: '藍鉄' }).click()
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'aitetsu')
      await expect.poll(async () => (await settingsOf(page))['appearance.theme']).toBe('aitetsu')

      // 検索：名称と説明で絞り込む
      await page.getByRole('searchbox', { name: '設定を検索' }).fill('タイムアウト')
      await expect(page.getByText('タイムアウト（ローカル）')).toBeVisible()
      await expect(page.getByText('タイムアウト（リモート）')).toBeVisible()
      await expect(page.getByText('隠しファイルを表示')).toHaveCount(0)
      await page.getByRole('searchbox', { name: '設定を検索' }).fill('zzzz-no-match')
      await expect(page.getByText('一致する設定がありません')).toBeVisible()

      await nav(page, 'このアプリについて').click()
      await expect(page.getByRole('tab', { name: 'このアプリについて' })).toBeVisible()
    } finally {
      await app.close()
    }
  })

  // 外観確認用（PCH_E2E_SHOT_DIR 指定時のみ）：既定テーマの明暗と藍鉄（ダーク）
  test('screenshots', async () => {
    const dir = process.env.PCH_E2E_SHOT_DIR
    test.skip(!dir, 'PCH_E2E_SHOT_DIR is not set')
    mkdirSync(dir!, { recursive: true })
    // 系统明暗不介入：明暗由设置决定
    const { app, page } = await launch(userData)
    try {
      await page.emulateMedia({ colorScheme: null })
      await openSettings(page)
      await nav(page, '外観').click()
      for (const [name, mode, theme] of [
        ['default-light', 'light', 'default'],
        ['default-dark', 'dark', 'default'],
        ['aitetsu-dark', 'dark', 'aitetsu']
      ] as const) {
        await data(page, 'settings.set', {
          'appearance.themeMode': mode,
          'appearance.theme': theme
        })
        await expect(page.locator('html')).toHaveClass(mode === 'dark' ? /dark/ : /^(?!.*dark)/)
        await page.screenshot({ path: path.join(dir!, `settings-${name}.png`) })
      }
      await nav(page, 'キャッシュとスキャン').click()
      await page.screenshot({ path: path.join(dir!, 'settings-cache-aitetsu-dark.png') })
    } finally {
      await app.close()
    }
  })
})
