import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { data, invoke, launch, removeDirs } from './support'

/** 假模式（PCH_E2E_FAKE_DESKTOP=1）：采集结果取 PCH_E2E_DESKTOP_ITEMS，恢复只记日志不启动程序 */
const EXCEL = {
  kind: 'office',
  app: 'excel',
  path: 'C:\\work\\a.xlsx',
  readOnly: false,
  exe: 'C:/Program Files/Microsoft Office/root/Office16/EXCEL.EXE'
}
const WORD = {
  kind: 'office',
  app: 'word',
  path: 'C:\\work\\b.docx',
  readOnly: false,
  exe: 'C:/Program Files/Microsoft Office/root/Office16/WINWORD.EXE'
}

test.describe('desktop snapshots', () => {
  let userData: string

  test.beforeEach(() => {
    userData = mkdtempSync(path.join(tmpdir(), 'pch-e2e-'))
  })
  test.afterEach(() => {
    removeDirs(userData)
  })

  const env = (logonAt: number, items: unknown[]): Record<string, string> => ({
    PCH_E2E_FAKE_DESKTOP: '1',
    PCH_E2E_LOGON_AT: String(logonAt),
    PCH_E2E_DESKTOP_ITEMS: JSON.stringify(items)
  })

  /** 以英文界面启动，并等到现场采集到全部项目 */
  const start = async (
    logonAt: number,
    items: unknown[]
  ): Promise<{ app: ElectronApplication; page: Page }> => {
    const launched = await launch(userData, env(logonAt, items))
    await data(launched.page, 'settings.set', { 'general.language': 'en' })
    await expect(launched.page.locator('html')).toHaveAttribute('lang', 'en')
    await expect
      .poll(
        async () =>
          (await data<{ items: unknown[] }>(launched.page, 'desktop.current')).items.length
      )
      .toBe(items.length)
    return launched
  }

  const dialog = (page: Page): Locator => page.getByRole('dialog')
  const box = (page: Page, name: RegExp | string): Locator =>
    dialog(page).getByRole('checkbox', { name })

  /** 真实的窗口关闭（走 close 事件，触发退出拦截） */
  const closeWindow = (page: Page): Promise<unknown> => invoke(page, 'window.close')

  const mainLog = (): string => readFileSync(path.join(userData, 'logs', 'main.log'), 'utf8')

  test('the activity bar shows the current items and save now adds a snapshot', async () => {
    const { app, page } = await start(1000, [EXCEL, WORD])
    try {
      await page.getByRole('button', { name: 'Desktop snapshots' }).click()
      const list = page.getByRole('list', { name: 'Desktop snapshots' })
      await expect(list.getByRole('button', { name: /Now/ })).toContainText('2')
      await list.getByRole('button', { name: /Now/ }).click()
      await expect(page.getByText('a.xlsx', { exact: true })).toBeVisible()
      await expect(page.getByText('b.docx', { exact: true })).toBeVisible()
      // 启动时已有一份自动记录（「Now」行 + 1 份）
      await expect(list.getByRole('listitem')).toHaveCount(2)
      await page.getByRole('button', { name: 'Save now' }).click()
      await expect(list.getByRole('listitem')).toHaveCount(3)
    } finally {
      await app.close()
    }
  })

  test('exit saving one item is offered for restore next start, and restore launches only it', async () => {
    const first = await start(1000, [EXCEL, WORD])
    try {
      await closeWindow(first.page)
      await expect(dialog(first.page)).toBeVisible()
      await expect(box(first.page, /a\.xlsx/)).toBeChecked()
      await expect(box(first.page, /b\.docx/)).toBeChecked()
      await box(first.page, /b\.docx/).click()
      await dialog(first.page).getByRole('button', { name: 'Save and exit' }).click()
      await first.app.waitForEvent('close')
    } finally {
      await first.app.close().catch(() => undefined)
    }

    const second = await start(2000, [])
    try {
      await expect(dialog(second.page)).toBeVisible()
      await expect(box(second.page, /a\.xlsx/)).toBeChecked()
      await expect(dialog(second.page).getByRole('checkbox', { name: /b\.docx/ })).toHaveCount(0)
      await dialog(second.page).getByRole('button', { name: 'Restore' }).click()
      await expect(dialog(second.page)).toBeHidden()
      await expect.poll(mainLog).toMatch(/\[desktop:fake\] spawn .*EXCEL\.EXE/i)
      expect(mainLog()).not.toMatch(/\[desktop:fake\] spawn .*WINWORD\.EXE/i)
    } finally {
      await second.app.close()
    }
  })

  test('exit without saving is not offered for restore next start', async () => {
    const first = await start(1000, [EXCEL, WORD])
    try {
      await closeWindow(first.page)
      await dialog(first.page).getByRole('button', { name: 'Exit without saving' }).click()
      await first.app.waitForEvent('close')
    } finally {
      await first.app.close().catch(() => undefined)
    }

    const second = await start(2000, [])
    try {
      // restorePrompt 在启动时已经调用过；对话框没有出现
      await second.page.waitForTimeout(1500)
      await expect(dialog(second.page)).toHaveCount(0)
    } finally {
      await second.app.close()
    }
  })

  test('"do not ask again" closes without a dialog and the next start offers everything', async () => {
    const first = await start(1000, [EXCEL, WORD])
    try {
      await closeWindow(first.page)
      await box(first.page, /b\.docx/).click()
      await dialog(first.page).getByRole('checkbox', { name: "Don't ask again" }).click()
      await dialog(first.page).getByRole('button', { name: 'Save and exit' }).click()
      await first.app.waitForEvent('close')
    } finally {
      await first.app.close().catch(() => undefined)
    }

    // 不再询问：直接保存全部并关闭，不出现对话框
    const second = await start(2000, [EXCEL, WORD])
    try {
      const closed = second.app.waitForEvent('close')
      await closeWindow(second.page)
      await closed
    } finally {
      await second.app.close().catch(() => undefined)
    }

    const third = await start(3000, [])
    try {
      await expect(dialog(third.page)).toBeVisible()
      await expect(box(third.page, /a\.xlsx/)).toBeChecked()
      await expect(box(third.page, /b\.docx/)).toBeChecked()
    } finally {
      await third.app.close()
    }
  })

  test('cancel keeps the window open and closing again asks again', async () => {
    const { app, page } = await start(1000, [EXCEL])
    try {
      await closeWindow(page)
      await dialog(page).getByRole('button', { name: 'Cancel' }).click()
      await expect(dialog(page)).toBeHidden()
      await page.waitForTimeout(500)
      expect(page.isClosed()).toBe(false)
      await closeWindow(page)
      await expect(dialog(page)).toBeVisible()
      // Esc = キャンセル
      await page.keyboard.press('Escape')
      await expect(dialog(page)).toBeHidden()
      expect(page.isClosed()).toBe(false)
    } finally {
      await app.close()
    }
  })

  test('the exit dialog stays open past the 10 s confirmation window, also after a repeated close', async () => {
    test.setTimeout(90_000)
    const { app, page } = await start(1000, [EXCEL])
    try {
      await closeWindow(page)
      await expect(dialog(page)).toBeVisible()
      await page.waitForTimeout(6000)
      // 对话框开着时用户又点了关闭：主进程重发请求并重新计时，渲染端必须再次确认已显示
      await closeWindow(page)
      await page.waitForTimeout(12_000)
      await expect(dialog(page)).toBeVisible()
      expect(page.isClosed()).toBe(false)
    } finally {
      await app.close().catch(() => undefined)
    }
  })
})
