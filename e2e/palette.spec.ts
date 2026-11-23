import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { data, launch, removeDirs } from './support'

test.describe('command palette', () => {
  let userData: string
  let files: string
  let project: string

  test.beforeEach(() => {
    userData = mkdtempSync(path.join(tmpdir(), 'pch-e2e-'))
    files = mkdtempSync(path.join(tmpdir(), 'pch-e2e-files-'))
    project = path.join(files, '案件')
    mkdirSync(path.join(project, '設計書'), { recursive: true })
    writeFileSync(path.join(project, '設計書', '仕様.txt'), 'spec')
    writeFileSync(path.join(project, '設計書', '設計メモ.txt'), 'memo')
    writeFileSync(path.join(project, 'README.md'), '# 案件')
  })
  test.afterEach(() => {
    removeDirs(userData, files)
  })

  /** 日语界面 + folder 条目；经 vfs.list 列出各目录（文件组只查缓存） */
  async function setup(page: Page): Promise<string> {
    await data(page, 'settings.set', { 'general.language': 'ja' })
    await expect(page.locator('html')).toHaveAttribute('lang', 'ja')
    const { id: workspaceId } = await data(page, 'workspace.active')
    await data(page, 'entry.add', { kind: 'folder', workspaceId, parentId: null, path: project })
    for (const dir of [project, path.join(project, '設計書')]) {
      await data(page, 'vfs.list', { uri: pathToFileURL(dir).href })
    }
    return workspaceId
  }

  const dialog = (page: Page): Locator => page.getByRole('dialog')
  const input = (page: Page): Locator => dialog(page).getByRole('combobox')
  const option = (page: Page, name: string | RegExp): Locator =>
    dialog(page).getByRole('option', { name })

  async function openPalette(page: Page): Promise<void> {
    await page.keyboard.press('Control+k')
    await expect(dialog(page)).toBeVisible()
    await expect(input(page)).toBeFocused()
  }

  test('Ctrl+K opens, filters and runs a command; Ctrl+K again closes', async () => {
    const { app, page } = await launch(userData)
    try {
      await setup(page)
      await openPalette(page)
      // 空查询：命令组在列，当前工作区不在工作区组，没有文件组
      await expect(dialog(page).getByText('コマンド', { exact: true })).toBeVisible()
      await expect(dialog(page).getByText('ファイル', { exact: true })).toHaveCount(0)
      await expect(option(page, '設定を開く')).toBeVisible()
      await expect(option(page, 'コマンドパレットを開く')).toHaveCount(1)

      await page.keyboard.press('Control+k')
      await expect(dialog(page)).toHaveCount(0)

      await openPalette(page)
      await input(page).fill('set')
      await expect(option(page, '設定を開く')).toBeVisible()
      await expect(option(page, 'このアプリについてを開く')).toHaveCount(0)
      await page.keyboard.press('Enter')
      await expect(dialog(page)).toHaveCount(0)
      await expect(page.getByRole('tab', { name: '設定' })).toBeVisible()

      // Ctrl+Shift+P でも開く；Esc で閉じる
      await page.keyboard.press('Control+Shift+P')
      await expect(dialog(page)).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(dialog(page)).toHaveCount(0)
    } finally {
      await app.close()
    }
  })

  test('the title bar search button opens the palette; appearance commands change settings', async () => {
    const { app, page } = await launch(userData)
    try {
      await setup(page)
      await page.getByRole('button', { name: /ファイルやコマンドを検索/ }).click()
      await expect(dialog(page)).toBeVisible()
      await input(page).fill('aitetsu')
      await option(page, 'カラーテーマ：藍鉄').click()
      await expect
        .poll(
          async () =>
            (await data<Record<string, unknown>>(page, 'settings.getAll'))['appearance.theme']
        )
        .toBe('aitetsu')
    } finally {
      await app.close()
    }
  })

  test('file results locate the item in the tree and open it; it then appears under recent', async () => {
    const { app, page } = await launch(userData)
    try {
      await setup(page)
      await openPalette(page)
      await input(page).fill('仕様')
      const hit = option(page, /仕様\.txt/)
      await expect(hit).toBeVisible()
      await page.keyboard.press('Enter')
      await expect(dialog(page)).toHaveCount(0)
      await expect(page.getByRole('tab', { name: '仕様.txt' })).toBeVisible()
      await expect(
        page.getByRole('tree').getByRole('treeitem', { name: '仕様.txt' })
      ).toHaveAttribute('aria-selected', 'true')

      await openPalette(page)
      await expect(option(page, /仕様\.txt/)).toBeVisible()
    } finally {
      await app.close()
    }
  })

  test('opening a recent item whose file was deleted shows the not-found state', async () => {
    const { app, page } = await launch(userData)
    try {
      await setup(page)
      await openPalette(page)
      await input(page).fill('設計メモ')
      await option(page, /設計メモ\.txt/).click()
      await expect(page.getByRole('tab', { name: '設計メモ.txt' })).toBeVisible()
      await page.getByRole('tab', { name: '設計メモ.txt' }).getByRole('button').click()
      await expect(page.getByRole('tab', { name: '設計メモ.txt' })).toHaveCount(0)

      rmSync(path.join(project, '設計書', '設計メモ.txt'))
      await openPalette(page)
      await expect(option(page, /設計メモ\.txt/)).toBeVisible()
      await page.keyboard.press('Enter')
      await expect(dialog(page)).toHaveCount(0)
      await expect(page.getByRole('tab', { name: '設計メモ.txt' })).toBeVisible()
      await expect(page.getByRole('tabpanel')).toContainText('見つかりません')
    } finally {
      await app.close()
    }
  })

  test('Enter while composing (IME) does not run the selected item', async () => {
    const { app, page } = await launch(userData)
    try {
      await setup(page)
      await openPalette(page)
      await input(page).fill('設定')
      await input(page).evaluate((el) => {
        el.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: 'Enter',
            keyCode: 229,
            isComposing: true,
            bubbles: true,
            cancelable: true
          })
        )
      })
      await expect(dialog(page)).toBeVisible()
      await expect(page.getByRole('tab', { name: '設定' })).toHaveCount(0)
    } finally {
      await app.close()
    }
  })

  test('typing right after Ctrl+K (without waiting for focus) keeps every character', async () => {
    const { app, page } = await launch(userData)
    try {
      await setup(page)
      // 确定性的探针：输入框刚插入 DOM（同一次提交）时焦点是否已经在它身上
      await page.evaluate((selector) => {
        const w = window as unknown as { __focusAtInsert?: boolean }
        const observer = new MutationObserver(() => {
          const el = document.querySelector(selector)
          if (el === null) return
          w.__focusAtInsert = document.activeElement === el
          observer.disconnect()
        })
        observer.observe(document.body, { childList: true, subtree: true })
      }, '[data-slot="command-input"]')
      await page.keyboard.press('Control+k')
      await page.keyboard.type('aitetsu')
      await expect(input(page)).toHaveValue('aitetsu')
      expect(
        await page.evaluate(
          () => (window as unknown as { __focusAtInsert?: boolean }).__focusAtInsert
        )
      ).toBe(true)
    } finally {
      await app.close()
    }
  })

  test('switching workspace from the palette shows the switched toast', async () => {
    const { app, page } = await launch(userData)
    try {
      await setup(page)
      await data(page, 'workspace.create', { name: '別件' })
      await openPalette(page)
      await input(page).fill('別件')
      await option(page, /別件/).click()
      await expect(dialog(page)).toHaveCount(0)
      await expect(page.getByText('「別件」に切り替えました')).toBeVisible()
    } finally {
      await app.close()
    }
  })
})
