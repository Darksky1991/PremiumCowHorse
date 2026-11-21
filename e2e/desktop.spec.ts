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
  exe: 'C:\\Program Files\\Microsoft Office\\root\\Office16\\EXCEL.EXE'
}
const WORD = {
  kind: 'office',
  app: 'word',
  path: 'C:\\work\\b.docx',
  readOnly: false,
  exe: 'C:\\Program Files\\Microsoft Office\\root\\Office16\\WINWORD.EXE'
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

  /** 窗口在一段时间内持续存在（关闭是异步的，只查一次可能赶在关闭之前） */
  const expectStaysOpen = async (page: Page, ms = 1500): Promise<void> => {
    const until = Date.now() + ms
    while (Date.now() < until) {
      expect(page.isClosed()).toBe(false)
      await page.waitForTimeout(100)
    }
  }

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
      // 点击卡片切换选中；Space 也能切换（卡片是 checkbox）
      await box(first.page, /b\.docx/).click()
      await expect(box(first.page, /b\.docx/)).not.toBeChecked()
      await box(first.page, /b\.docx/).focus()
      await first.page.keyboard.press('Space')
      await expect(box(first.page, /b\.docx/)).toBeChecked()
      await box(first.page, /b\.docx/).click()
      await expect(box(first.page, /b\.docx/)).not.toBeChecked()
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

  test('restoring clears every snapshot and then rescans into a single new auto snapshot', async () => {
    test.setTimeout(60_000)
    const first = await start(1000, [EXCEL, WORD])
    try {
      await closeWindow(first.page)
      await dialog(first.page).getByRole('button', { name: 'Save and exit' }).click()
      await first.app.waitForEvent('close')
    } finally {
      await first.app.close().catch(() => undefined)
    }

    const second = await start(2000, [EXCEL])
    try {
      await expect(dialog(second.page)).toBeVisible()
      await dialog(second.page).getByRole('button', { name: 'Restore' }).click()
      await expect(dialog(second.page)).toBeHidden()
      await second.page.getByRole('button', { name: 'Desktop snapshots' }).click()
      const list = second.page.getByRole('list', { name: 'Desktop snapshots' })
      // 清空：只剩「Now」行；约 10 秒后重新扫描写入一份新的自动快照
      await expect(list).toContainText('No snapshots yet')
      await expect(list).not.toContainText('No snapshots yet', { timeout: 25_000 })
      await expect(list.getByRole('listitem')).toHaveCount(2)
      await expect(list).toContainText('Autosave')
      await second.page.waitForTimeout(1000)
      await expect(list.getByRole('listitem')).toHaveCount(2)
    } finally {
      await second.app.close().catch(() => undefined)
    }
  })

  test('restoring from a snapshot page clears it and moves the tab to the Now page', async () => {
    const { app, page } = await start(1000, [EXCEL])
    try {
      await page.getByRole('button', { name: 'Desktop snapshots' }).click()
      const list = page.getByRole('list', { name: 'Desktop snapshots' })
      await page.getByRole('button', { name: 'Save now' }).click()
      await list.getByRole('button', { name: /Manual save/ }).click()
      await expect(page.getByRole('checkbox', { name: /a\.xlsx/ })).toBeChecked()
      // a.xlsx 已开着 = open（视为已处理）→ 清空快照，标签改为「Now」页
      await page.getByRole('button', { name: 'Restore selected items' }).click()
      await expect(page.getByRole('heading', { name: 'Now' })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeVisible()
      await expect(list).toContainText('No snapshots yet')
      await expect(page.getByText('This snapshot no longer exists')).toHaveCount(0)
      // 快照被清空后页面的重新获取不按 error 记日志
      expect(mainLog()).not.toMatch(/\[error\][^\n]*DESKTOP_SNAPSHOT_NOT_FOUND/)
    } finally {
      await app.close()
    }
  })

  test('a restore with a failed item keeps the snapshot and stays on its page', async () => {
    // 白名单外的 exe → failed：快照不清空（Ruling 14）
    const notepad = { ...WORD, path: 'C:\\work\\c.docx', exe: 'C:\\Windows\\notepad.exe' }
    const first = await start(1000, [notepad])
    try {
      await closeWindow(first.page)
      await dialog(first.page).getByRole('button', { name: 'Save and exit' }).click()
      await first.app.waitForEvent('close')
    } finally {
      await first.app.close().catch(() => undefined)
    }

    // 下一次登录：c.docx 没开着；启动时的恢复对话框选「Later」，再从快照页恢复
    const { app, page } = await start(2000, [])
    try {
      await dialog(page).getByRole('button', { name: 'Later' }).click()
      await page.getByRole('button', { name: 'Desktop snapshots' }).click()
      const list = page.getByRole('list', { name: 'Desktop snapshots' })
      await list.getByRole('button', { name: /Saved on exit/ }).click()
      await page.getByRole('button', { name: 'Restore selected items' }).click()
      await expect(page.getByText(/failed to start/i)).toBeVisible()
      await expect(page.getByRole('checkbox', { name: /c\.docx/ })).toBeVisible()
      await expect(list.getByRole('button', { name: /Saved on exit/ })).toBeVisible()
      await expect(page.getByRole('heading', { name: 'Now' })).toHaveCount(0)
    } finally {
      await app.close()
    }
  })

  test('the sidebar menu turns asking on exit back on', async () => {
    const { app, page } = await start(1000, [EXCEL])
    try {
      await data(page, 'settings.set', { 'desktop.askOnExit': false })
      await page.getByRole('button', { name: 'Desktop snapshots' }).click()
      await page.getByRole('button', { name: 'More actions' }).click()
      const item = page.getByRole('menuitemcheckbox', { name: 'Ask before exiting' })
      await expect(item).not.toBeChecked()
      await item.click()
      await expect
        .poll(
          async () =>
            (await data<Record<string, unknown>>(page, 'settings.getAll'))['desktop.askOnExit']
        )
        .toBe(true)
      await page.keyboard.press('Escape')
      await closeWindow(page)
      await expect(dialog(page)).toBeVisible()
      await dialog(page).getByRole('button', { name: 'Cancel' }).click()
      await expect(dialog(page)).toBeHidden()
    } finally {
      await app.close()
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
      await expectStaysOpen(page)
      await closeWindow(page)
      await expect(dialog(page)).toBeVisible()
      // Esc = キャンセル
      await page.keyboard.press('Escape')
      await expect(dialog(page)).toBeHidden()
      await expectStaysOpen(page)
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

  test('closing right after start shows only the exit dialog, and cancel does not bring the restore dialog back', async () => {
    const first = await start(1000, [EXCEL])
    try {
      await closeWindow(first.page)
      await dialog(first.page).getByRole('button', { name: 'Save and exit' }).click()
      await first.app.waitForEvent('close')
    } finally {
      await first.app.close().catch(() => undefined)
    }

    // 上次登录有可恢复的快照；启动后立刻关闭（不等现场采集与恢复提示）
    const { app, page } = await launch(userData, env(2000, []))
    try {
      // 渲染端订阅事件之前发出的关闭请求会丢：等界面就绪（侧栏出现）再关闭
      await expect(
        page.getByRole('button', { name: 'Desktop snapshots', includeHidden: true })
      ).toBeAttached()
      await closeWindow(page)
      await expect(
        page.getByRole('dialog', { name: 'Save your desktop before exiting?' })
      ).toBeVisible()
      await page.waitForTimeout(1500)
      await expect(dialog(page)).toHaveCount(1)
      await dialog(page).getByRole('button', { name: 'Cancel' }).click()
      await page.waitForTimeout(1500)
      await expect(dialog(page)).toHaveCount(0)
    } finally {
      await app.close().catch(() => undefined)
    }
  })
})
