import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { data, launchFast, removeDirs, toggleRow } from './support'

/** 假 launcher 记录的启动（PCH_E2E_FAKE_LAUNCHER=1：检测返回固定 JSON，启动为空操作） */
const launches = (app: ElectronApplication): Promise<Array<Record<string, string>>> =>
  app.evaluate(() =>
    (
      (globalThis as unknown as { __pchFakeLaunches?: Array<{ env: Record<string, string> }> })
        .__pchFakeLaunches ?? []
    ).map((l) => l.env)
  )

test.describe('office launch panel', () => {
  let userData: string
  let files: string
  let project: string

  test.beforeEach(() => {
    userData = mkdtempSync(path.join(tmpdir(), 'pch-e2e-'))
    files = mkdtempSync(path.join(tmpdir(), 'pch-e2e-files-'))
    project = path.join(files, '案件')
    mkdirSync(project, { recursive: true })
    writeFileSync(path.join(project, 'a.xlsx'), 'x')
    writeFileSync(path.join(project, 'b.docx'), 'x')
    writeFileSync(path.join(project, 'c.xls'), 'x')
  })
  test.afterEach(() => {
    removeDirs(userData, files)
  })

  const panel = (page: Page): Locator => page.getByRole('tabpanel')
  const grid = (page: Page): Locator => panel(page).getByRole('grid')
  const row = (page: Page, name: string): Locator =>
    grid(page)
      .locator('[role="row"][data-index]')
      .filter({ has: page.getByTitle(name, { exact: true }) })

  test('single click in the tree and double click in the folder view both show the panel without launching', async () => {
    const { app, page } = await launchFast(userData, { PCH_E2E_FAKE_LAUNCHER: '1' })
    try {
      await data(page, 'settings.set', { 'general.language': 'en' })
      await expect(page.locator('html')).toHaveAttribute('lang', 'en')
      const { id: workspaceId } = await data(page, 'workspace.active')
      await data(page, 'entry.add', { kind: 'folder', workspaceId, parentId: null, path: project })
      const tree = page.getByRole('tree')
      await toggleRow(tree.getByRole('treeitem', { name: '案件' }))

      // 资源树单击：面板，按 options 的顺序显示 4 个按钮（Excel：edit / readOnly(/r) / protectedView / newFromFile）
      await tree.getByRole('treeitem', { name: 'a.xlsx' }).click()
      const info = panel(page)
      await expect(info.getByRole('heading', { name: 'a.xlsx' })).toBeVisible()
      await expect(info).toContainText(path.join(project, 'a.xlsx'))
      await expect(info).toContainText('Open with Microsoft Excel')
      const modeButtons = info.getByRole('button', {
        name: /^(Edit|Read-only|Create new|Protected View)$/
      })
      await expect(modeButtons).toHaveText(['Edit', 'Read-only', 'Protected View', 'Create new'])
      expect(await launches(app)).toEqual([])

      // 按钮：按下时才启动（假 run 只记录），按所选方式
      await info.getByRole('button', { name: 'Protected View' }).click()
      await expect
        .poll(async () => (await launches(app)).map((l) => l.PCH_VERB))
        .toEqual(['ViewProtected'])
      await info.getByRole('button', { name: 'Read-only' }).click()
      await expect.poll(async () => (await launches(app)).length).toBe(2)
      const second = (await launches(app))[1]!
      expect(second.PCH_EXE).toMatch(/EXCEL\.EXE$/)
      expect(JSON.parse(second.PCH_ARGS ?? '[]')).toEqual(['/r', path.join(project, 'a.xlsx')])
      // 启动结束后按钮恢复可用
      await expect(info.getByRole('button', { name: 'Edit' })).toBeEnabled()

      // 查看器下拉含「File info」
      await page.getByRole('button', { name: 'View as', exact: true }).click()
      await expect(page.getByRole('menuitemradio', { name: 'File info' })).toBeVisible()
      await page.keyboard.press('Escape')

      // 目录视图双击：同样显示面板、不启动；应用名为空串时显示通用说法（假检测对 docx 给出空串）
      await tree.getByRole('treeitem', { name: '案件' }).dblclick()
      await row(page, 'b.docx').dblclick()
      await expect(panel(page).getByRole('heading', { name: 'b.docx' })).toBeVisible()
      await expect(panel(page)).toContainText('Open with the associated app')
      expect(await launches(app)).toHaveLength(2)

      // 检测不到任何方式：只有「Open with default app」
      await tree.getByRole('treeitem', { name: 'c.xls' }).click()
      await expect(panel(page).getByRole('heading', { name: 'c.xls' })).toBeVisible()
      await expect(panel(page).getByRole('button', { name: 'Open with default app' })).toBeVisible()
      await expect(panel(page).getByRole('button', { name: 'Edit' })).toHaveCount(0)

      // 再検出：重新取得后仍显示按钮
      await tree.getByRole('treeitem', { name: 'a.xlsx' }).click()
      await panel(page).getByRole('button', { name: 'Re-detect' }).click()
      await expect(panel(page).getByRole('button', { name: 'Edit' })).toBeVisible()
    } finally {
      await app.close()
    }
  })
})
