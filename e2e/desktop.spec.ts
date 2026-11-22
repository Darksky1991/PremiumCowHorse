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
      await expect.poll(mainLog).toMatch(/\[desktop:fake\] spawn .*EXCEL\.EXE/i)
      expect(mainLog()).not.toMatch(/\[desktop:fake\] spawn .*WINWORD\.EXE/i)
      // 恢复后询问是否删除快照：默认焦点在「Keep」，选它则快照保留
      await expect(dialog(second.page)).toContainText('Delete the saved snapshots?')
      await expect(dialog(second.page).getByRole('button', { name: 'Keep' })).toBeFocused()
      await dialog(second.page).getByRole('button', { name: 'Keep' }).click()
      await expect(dialog(second.page)).toBeHidden()
      await second.page.getByRole('button', { name: 'Desktop snapshots' }).click()
      const list = second.page.getByRole('list', { name: 'Desktop snapshots' })
      await expect(list.getByRole('button', { name: /Saved on exit/ })).toBeVisible()
    } finally {
      await second.app.close()
    }
  })

  test('Explorer tabs are separate cards grouped by window, for exit and for restore', async () => {
    const tabs = ['C:\\work\\t1', 'C:\\work\\t2', 'C:\\work\\t3']
    const windowItem = { kind: 'explorer', tabs, bounds: null }
    const single = { kind: 'explorer', tabs: ['D:\\solo'], bounds: null }
    const first = await start(1000, [windowItem, single])
    try {
      await closeWindow(first.page)
      const group = dialog(first.page).getByRole('group', { name: 'Same window · 3 tab(s)' })
      await expect(group.getByRole('checkbox')).toHaveCount(3)
      // 单标签窗口不在窗口框内
      await expect(group.getByRole('checkbox', { name: /solo/ })).toHaveCount(0)
      await expect(box(first.page, /solo/)).toBeChecked()
      // 退出时只保存 t1、t3
      await group.getByRole('checkbox', { name: /^t2/ }).click()
      await expect(dialog(first.page)).toContainText('3 / 4 selected')
      await dialog(first.page).getByRole('button', { name: 'Save and exit' }).click()
      await first.app.waitForEvent('close')
    } finally {
      await first.app.close().catch(() => undefined)
    }

    const second = await start(2000, [])
    try {
      const group = dialog(second.page).getByRole('group', { name: 'Same window · 2 tab(s)' })
      await expect(group.getByRole('checkbox')).toHaveCount(2)
      await expect(group.getByRole('checkbox', { name: /^t2/ })).toHaveCount(0)
      // 恢复时再去掉 t3 与单标签窗口：只剩 t1，单标签直接用 explorer.exe 打开
      await group.getByRole('checkbox', { name: /^t3/ }).click()
      await box(second.page, /solo/).click()
      await dialog(second.page).getByRole('button', { name: 'Restore' }).click()
      await expect.poll(mainLog).toMatch(/\[desktop:fake\] spawn .*explorer\.exe .*t1/i)
      expect(mainLog()).not.toMatch(/\[desktop:fake\] (spawn|powershell) .*(t3|solo)/i)
      await dialog(second.page).getByRole('button', { name: 'Keep' }).click()
      await expect(dialog(second.page)).toBeHidden()
    } finally {
      await second.app.close()
    }
  })

  test('cards have the same height across groups', async () => {
    const longPath = `C:\\${'very long folder name '.repeat(8)}\\x.xlsx`
    const { app, page } = await start(1000, [
      { ...EXCEL, path: longPath, readOnly: true },
      WORD,
      {
        kind: 'explorer',
        tabs: ['::{20D04FE0-3AEA-1069-A2D8-08002B30309D}', 'C:\\w'],
        bounds: null
      }
    ])
    try {
      await page.getByRole('button', { name: 'Desktop snapshots' }).click()
      await page
        .getByRole('list', { name: 'Desktop snapshots' })
        .getByRole('button', { name: /Now/ })
        .click()
      const cards = page.getByRole('checkbox')
      await expect(cards).toHaveCount(4)
      const heights = await cards.evaluateAll((els) =>
        els.map((e) => Math.round(e.getBoundingClientRect().height))
      )
      expect(new Set(heights).size).toBe(1)
    } finally {
      await app.close()
    }
  })

  test('confirming deletion after a restore leaves a single new auto snapshot', async () => {
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
      // 上次的退出快照 + 本次的自动快照
      await expect(dialog(second.page)).toContainText('2 saved snapshot(s)')
      await dialog(second.page).getByRole('button', { name: 'Delete' }).click()
      await expect(dialog(second.page)).toBeHidden()
      await second.page.getByRole('button', { name: 'Desktop snapshots' }).click()
      const list = second.page.getByRole('list', { name: 'Desktop snapshots' })
      // 删除全部后立即重新记录：只剩「Now」行 + 一份新的自动快照；约 10 秒后的重新扫描原地更新，不多出一份
      await expect(list.getByRole('listitem')).toHaveCount(2)
      await expect(list).toContainText('Autosave')
      await expect(list).not.toContainText('Saved on exit')
      await second.page.waitForTimeout(12_000)
      await expect(list.getByRole('listitem')).toHaveCount(2)
    } finally {
      await second.app.close().catch(() => undefined)
    }
  })

  test('deleting after a restore from a snapshot page moves the tab to the Now page', async () => {
    const { app, page } = await start(1000, [EXCEL])
    try {
      await page.getByRole('button', { name: 'Desktop snapshots' }).click()
      const list = page.getByRole('list', { name: 'Desktop snapshots' })
      await page.getByRole('button', { name: 'Save now' }).click()
      await list.getByRole('button', { name: /Manual save/ }).click()
      await expect(page.getByRole('checkbox', { name: /a\.xlsx/ })).toBeChecked()
      await page.getByRole('button', { name: 'Restore selected items' }).click()
      // 确认删除 → 标签改为「Now」页，只剩新的自动快照
      await dialog(page).getByRole('button', { name: 'Delete' }).click()
      await expect(page.getByRole('heading', { name: 'Now' })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeVisible()
      await expect(list).not.toContainText('Manual save')
      await expect(list).toContainText('Autosave')
      await expect(page.getByText('This snapshot no longer exists')).toHaveCount(0)
      // 快照被清空后页面的重新获取不按 error 记日志
      expect(mainLog()).not.toMatch(/\[error\][^\n]*DESKTOP_SNAPSHOT_NOT_FOUND/)
    } finally {
      await app.close()
    }
  })

  test('a restore with a failed item suggests keeping, and keeping stays on its page', async () => {
    // 白名单外的 exe → failed：确认框提示保留快照以便再试
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
      await expect(page.getByText(/failed to start/i).first()).toBeVisible()
      await expect(dialog(page)).toContainText('Keep the snapshots to try again later')
      await page.keyboard.press('Escape')
      await expect(dialog(page)).toBeHidden()
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
