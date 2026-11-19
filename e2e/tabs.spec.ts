import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { data, launchFast, removeDirs } from './support'

const closeLabel = /^(閉じる|关闭|Close)$/

test.describe('tabs opened from the explorer tree', () => {
  let userData: string
  let files: string
  let project: string

  test.beforeEach(() => {
    userData = mkdtempSync(path.join(tmpdir(), 'pch-e2e-'))
    files = mkdtempSync(path.join(tmpdir(), 'pch-e2e-files-'))
    project = path.join(files, '案件')
    mkdirSync(path.join(project, '設計書'), { recursive: true })
    writeFileSync(path.join(project, 'README.md'), '# 案件')
    writeFileSync(path.join(project, 'メモ.txt'), 'memo')
  })
  test.afterEach(() => {
    removeDirs(userData, files)
  })

  /** 添加条目「案件」并展开它，返回树 */
  async function setup(page: Page): Promise<Locator> {
    const { id: workspaceId } = await data(page, 'workspace.active')
    await data(page, 'entry.add', { kind: 'folder', workspaceId, parentId: null, path: project })
    const tree = page.getByRole('tree')
    await expect(tree.getByRole('treeitem', { name: '案件' })).toBeVisible()
    return tree
  }

  const tabs = (page: Page): Locator => page.getByRole('tablist').getByRole('tab')
  const tab = (page: Page, name: string): Locator =>
    page.getByRole('tablist').getByRole('tab', { name, exact: true })

  test('single click previews in one reused tab; double click and Enter open permanent tabs', async () => {
    const { app, page } = await launchFast(userData)
    try {
      const tree = await setup(page)
      const welcome = page.getByRole('heading', { level: 1 })
      await expect(welcome).toBeVisible()

      // 单击条目根：以预览标签打开（斜体），同时展开
      await tree.getByRole('treeitem', { name: '案件' }).click()
      await expect(tabs(page)).toHaveCount(1)
      await expect(tab(page, '案件')).toHaveAttribute('aria-selected', 'true')
      await expect(tab(page, '案件')).toHaveCSS('font-style', 'italic')
      await expect(welcome).toHaveCount(0)
      await expect(page.getByRole('tabpanel')).toContainText(pathToFileURL(project).href)
      // 悬停提示为完整路径
      await expect(tab(page, '案件')).toHaveAttribute('title', project)

      // 单击另一个：替换预览标签
      await tree.getByRole('treeitem', { name: 'README.md' }).click()
      await expect(tabs(page)).toHaveCount(1)
      await expect(tab(page, 'README.md')).toHaveCSS('font-style', 'italic')

      // 双击：转为常驻；之后的单击另开一个预览标签
      await tree.getByRole('treeitem', { name: 'README.md' }).dblclick()
      await expect(tabs(page)).toHaveCount(1)
      await expect(tab(page, 'README.md')).toHaveCSS('font-style', 'normal')
      await tree.getByRole('treeitem', { name: '設計書' }).click()
      await expect(tabs(page)).toHaveText(['README.md', '設計書'])
      await expect(tab(page, '設計書')).toHaveCSS('font-style', 'italic')

      // 已打开的 URI：单击只激活
      await tree.getByRole('treeitem', { name: 'README.md' }).click()
      await expect(tabs(page)).toHaveCount(2)
      await expect(tab(page, 'README.md')).toHaveAttribute('aria-selected', 'true')

      // 双击标签头：预览转常驻
      await tab(page, '設計書').dblclick()
      await expect(tab(page, '設計書')).toHaveCSS('font-style', 'normal')

      // 键盘：↑↓ 只移动选中、不打开；Enter 以常驻标签打开
      await tree.focus()
      const memo = tree.getByRole('treeitem', { name: 'メモ.txt' })
      while ((await memo.getAttribute('aria-selected')) !== 'true') {
        await page.keyboard.press('ArrowDown')
      }
      await expect(tabs(page)).toHaveCount(2)
      await page.keyboard.press('Enter')
      await expect(tabs(page)).toHaveText(['README.md', '設計書', 'メモ.txt'])
      await expect(tab(page, 'メモ.txt')).toHaveAttribute('aria-selected', 'true')
      await expect(tab(page, 'メモ.txt')).toHaveCSS('font-style', 'normal')

      // 标签栏的键盘：←→ 切换激活标签，焦点随之移动
      await tab(page, 'メモ.txt').focus()
      await page.keyboard.press('ArrowLeft')
      await expect(tab(page, '設計書')).toHaveAttribute('aria-selected', 'true')
      await expect(tab(page, '設計書')).toBeFocused()
      await page.keyboard.press('End')
      await expect(tab(page, 'メモ.txt')).toBeFocused()
    } finally {
      await app.close()
    }
  })

  test('× button, middle click and Ctrl+W close tabs; closing the last one shows the welcome page', async () => {
    const { app, page } = await launchFast(userData)
    try {
      const tree = await setup(page)
      await tree.getByRole('treeitem', { name: '案件' }).dblclick()
      for (const name of ['設計書', 'README.md', 'メモ.txt']) {
        await tree.getByRole('treeitem', { name }).dblclick()
      }
      await expect(tabs(page)).toHaveText(['案件', '設計書', 'README.md', 'メモ.txt'])

      // × 按钮（关闭非激活标签：激活标签不变）
      await tab(page, '設計書').getByRole('button', { name: closeLabel }).click()
      await expect(tabs(page)).toHaveText(['案件', 'README.md', 'メモ.txt'])
      await expect(tab(page, 'メモ.txt')).toHaveAttribute('aria-selected', 'true')

      // 中键
      await tab(page, 'README.md').click({ button: 'middle' })
      await expect(tabs(page)).toHaveText(['案件', 'メモ.txt'])

      // Ctrl+W 关闭激活标签，激活相邻标签（右侧没有 → 左侧）
      await page.keyboard.press('Control+w')
      await expect(tabs(page)).toHaveText(['案件'])
      await expect(tab(page, '案件')).toHaveAttribute('aria-selected', 'true')
      await page.keyboard.press('Control+w')
      await expect(page.getByRole('tablist')).toHaveCount(0)
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
      // 窗口仍在（Ctrl+W 没有关闭窗口）
      expect(app.windows()).toHaveLength(1)
    } finally {
      await app.close()
    }
  })

  test('with explorer.singleClickPreview off a single click only selects', async () => {
    const { app, page } = await launchFast(userData)
    try {
      await data(page, 'settings.set', { 'explorer.singleClickPreview': false })
      const tree = await setup(page)
      const root = tree.getByRole('treeitem', { name: '案件' })
      await root.click()
      await expect(root).toHaveAttribute('aria-selected', 'true')
      // 单击仍然展开（与设置无关）
      await expect(tree.getByRole('treeitem', { name: 'README.md' })).toBeVisible()
      await tree.getByRole('treeitem', { name: 'README.md' }).click()
      await expect(tree.getByRole('treeitem', { name: 'README.md' })).toHaveAttribute(
        'aria-selected',
        'true'
      )
      await expect(page.getByRole('tablist')).toHaveCount(0)
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()

      // 双击照常以常驻标签打开
      await tree.getByRole('treeitem', { name: 'README.md' }).dblclick()
      await expect(tabs(page)).toHaveText(['README.md'])
      await expect(tab(page, 'README.md')).toHaveCSS('font-style', 'normal')
    } finally {
      await app.close()
    }
  })
})
