import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import { data, launch, removeDirs } from './support'

test.describe('about page', () => {
  let userData: string
  test.beforeEach(() => {
    userData = mkdtempSync(path.join(tmpdir(), 'pch-e2e-'))
  })
  test.afterEach(() => {
    removeDirs(userData)
  })

  test('shows version info and opens the log folder through the main process', async () => {
    const { app, page } = await launch(userData)
    try {
      await data(page, 'settings.set', { 'general.language': 'ja' })
      await expect(page.locator('html')).toHaveAttribute('lang', 'ja')
      // 替换 shell.openPath 为计数（打开资源管理器不属于测试）
      await app.evaluate(({ shell }) => {
        const calls: string[] = []
        ;(globalThis as unknown as { __pchOpened: string[] }).__pchOpened = calls
        Object.assign(shell, {
          openPath: async (p: string) => {
            calls.push(p)
            return ''
          }
        })
      })
      // 活动栏齿轮 → 设置页 → 左侧导航最后一项「このアプリについて」
      await page.getByRole('button', { name: '設定', exact: true }).click()
      await page
        .getByRole('navigation', { name: '設定の分類' })
        .getByRole('button', { name: 'このアプリについて' })
        .click()
      await expect(page.getByRole('tab', { name: 'このアプリについて' })).toBeVisible()
      const tab = page.getByRole('tab', { name: 'このアプリについて' })
      await expect(tab).toBeVisible()
      await tab.click()
      const panel = page.getByRole('tabpanel')
      await expect(panel.getByText('v0.1.0').first()).toBeVisible()
      await expect(panel.getByText(userData, { exact: false }).first()).toBeVisible()
      await page.screenshot({ path: process.env.PCH_E2E_SHOT ?? path.join(userData, 'about.png') })

      await panel.getByRole('button', { name: 'ログフォルダーを開く' }).click()
      const opened = (): Promise<string[]> =>
        app.evaluate(() => (globalThis as unknown as { __pchOpened: string[] }).__pchOpened)
      await expect.poll(opened).toEqual([path.join(userData, 'logs')])
    } finally {
      await app.close()
    }
  })
})
