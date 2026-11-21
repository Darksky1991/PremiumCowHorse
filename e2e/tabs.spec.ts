import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { data, launchFast, removeDirs, toggleRow } from './support'

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
    writeFileSync(path.join(project, '設計書', 'v1.txt'), 'v1')
    writeFileSync(path.join(project, 'README.md'), '# 案件')
    writeFileSync(path.join(project, 'メモ.txt'), 'memo')
  })
  test.afterEach(() => {
    removeDirs(userData, files)
  })

  /** 界面语言设为 en（断言固定文案），添加条目「案件」，返回树 */
  async function setup(page: Page): Promise<Locator> {
    await data(page, 'settings.set', { 'general.language': 'en' })
    await expect(page.locator('html')).toHaveAttribute('lang', 'en')
    const { id: workspaceId } = await data(page, 'workspace.active')
    await data(page, 'entry.add', { kind: 'folder', workspaceId, parentId: null, path: project })
    const tree = page.getByRole('tree')
    await expect(tree.getByRole('treeitem', { name: '案件' })).toBeVisible()
    return tree
  }

  const tabs = (page: Page): Locator => page.getByRole('tablist').getByRole('tab')
  const tab = (page: Page, name: string): Locator =>
    page.getByRole('tablist').getByRole('tab', { name, exact: true })
  const backButton = (page: Page): Locator =>
    page
      .getByRole('navigation', { name: 'Address bar' })
      .getByRole('button', { name: 'Back', exact: true })

  test('single click opens in the current tab without expanding; double click and the arrow expand; middle / Ctrl+click and the menu open new tabs', async () => {
    const { app, page } = await launchFast(userData)
    try {
      const tree = await setup(page)
      const welcome = page.getByRole('heading', { level: 1 })
      await expect(welcome).toBeVisible()
      const root = tree.getByRole('treeitem', { name: '案件' })

      // 单击目录：没有标签时新建一个；只选中、不展开（需求 7）；标签不是斜体（没有预览标签）
      await root.click()
      await expect(tabs(page)).toHaveText(['案件'])
      await expect(tab(page, '案件')).toHaveAttribute('aria-selected', 'true')
      await expect(tab(page, '案件')).toHaveCSS('font-style', 'normal')
      await expect(tab(page, '案件')).toHaveAttribute('title', project)
      await expect(welcome).toHaveCount(0)
      await expect(page.getByRole('tabpanel').getByRole('grid', { name: '案件' })).toBeVisible()
      await expect(root).toHaveAttribute('aria-expanded', 'false')
      await expect(tree.getByRole('treeitem', { name: 'README.md' })).toHaveCount(0)

      // 双击目录：展开 / 折叠（第一次单击在当前标签打开的是同一位置，不另开标签）
      await root.dblclick()
      await expect(root).toHaveAttribute('aria-expanded', 'true')
      await expect(tree.getByRole('treeitem', { name: 'README.md' })).toBeVisible()
      await root.dblclick()
      await expect(root).toHaveAttribute('aria-expanded', 'false')
      // 箭头：只展开 / 折叠，不打开、不改变选中
      await toggleRow(root)
      await expect(root).toHaveAttribute('aria-expanded', 'true')
      await expect(tabs(page)).toHaveText(['案件'])
      await expect(backButton(page)).toBeDisabled()

      // 单击文件：在当前标签打开（进入历史，后退回到目录）；查看器的区别见下一个用例
      await tree.getByRole('treeitem', { name: 'README.md' }).click()
      await expect(tabs(page)).toHaveText(['README.md'])
      await backButton(page).click()
      await expect(tabs(page)).toHaveText(['案件'])
      // 文件的双击也在当前标签打开：不另开标签
      await tree.getByRole('treeitem', { name: 'メモ.txt' }).dblclick()
      await expect(tabs(page)).toHaveText(['メモ.txt'])

      // 中键 / Ctrl+单击：在新标签打开（插在激活标签右侧）
      await tree.getByRole('treeitem', { name: '設計書' }).click({ button: 'middle' })
      await expect(tabs(page)).toHaveText(['メモ.txt', '設計書'])
      await expect(tab(page, '設計書')).toHaveAttribute('aria-selected', 'true')
      await tree.getByRole('treeitem', { name: 'README.md' }).click({ modifiers: ['Control'] })
      await expect(tabs(page)).toHaveText(['メモ.txt', '設計書', 'README.md'])
      // 同 URI 已打开：只激活
      await tree.getByRole('treeitem', { name: '設計書' }).click({ button: 'middle' })
      await expect(tabs(page)).toHaveCount(3)
      await expect(tab(page, '設計書')).toHaveAttribute('aria-selected', 'true')

      // 右键菜单「在新标签页中打开」
      await root.click({ button: 'right' })
      await page.getByRole('menuitem', { name: 'Open in New Tab' }).click()
      await expect(tabs(page)).toHaveText(['メモ.txt', '設計書', '案件', 'README.md'])
      await expect(tab(page, '案件')).toHaveAttribute('aria-selected', 'true')

      // 双击标签头不再有特别的作用（没有「转常驻」）：只激活
      await tab(page, 'README.md').dblclick()
      await expect(tabs(page)).toHaveCount(4)
      await expect(tab(page, 'README.md')).toHaveAttribute('aria-selected', 'true')

      // 键盘：Enter 在当前标签打开（不等防抖），Ctrl+Enter 在新标签打开（同 URI 已打开则只激活）
      const design = tree.getByRole('treeitem', { name: '設計書' })
      await toggleRow(design)
      await tab(page, 'README.md').click()
      await expect(tree.getByRole('treeitem', { name: 'README.md' })).toHaveAttribute(
        'aria-selected',
        'true'
      )
      await tree.focus()
      await page.keyboard.press('ArrowUp')
      await expect(tree.getByRole('treeitem', { name: 'v1.txt' })).toHaveAttribute(
        'aria-selected',
        'true'
      )
      await page.keyboard.press('Enter')
      await expect(tabs(page)).toHaveText(['メモ.txt', '設計書', '案件', 'v1.txt'])
      await expect(tab(page, 'v1.txt')).toHaveAttribute('aria-selected', 'true')
      await page.keyboard.press('ArrowUp')
      await page.keyboard.press('Control+Enter')
      await expect(tab(page, '設計書')).toHaveAttribute('aria-selected', 'true')
      // Ctrl+Enter 取消了 ↑ 的防抖打开：v1.txt 的标签没有被换成「設計書」
      await page.waitForTimeout(800)
      await expect(tabs(page)).toHaveText(['メモ.txt', '設計書', '案件', 'v1.txt'])

      // 标签栏的键盘：←→ 切换激活标签，焦点随之移动
      await tab(page, '設計書').focus()
      await page.keyboard.press('ArrowLeft')
      await expect(tab(page, 'メモ.txt')).toHaveAttribute('aria-selected', 'true')
      await expect(tab(page, 'メモ.txt')).toBeFocused()
      await page.keyboard.press('End')
      await expect(tab(page, 'v1.txt')).toBeFocused()
    } finally {
      await app.close()
    }
  })

  test('file nodes: a single click / arrow stop shows file info in the current tab (nothing if already shown), a double click / Enter the default viewer, Ctrl+click / middle / Ctrl+Enter a new tab', async () => {
    writeFileSync(path.join(project, 'メモ2.txt'), 'memo2')
    writeFileSync(path.join(project, 'メモ3.txt'), 'memo3')
    const { app, page } = await launchFast(userData)
    try {
      const tree = await setup(page)
      const item = (name: string): Locator => tree.getByRole('treeitem', { name, exact: true })
      const panel = page.getByRole('tabpanel')
      const info = panel.getByRole('region', { name: 'File info' })
      const text = panel.getByRole('region', { name: 'File content' })
      const forwardButton = page
        .getByRole('navigation', { name: 'Address bar' })
        .getByRole('button', { name: 'Forward', exact: true })
      await toggleRow(item('案件'))

      // 单击文件：当前标签（没有标签时新建）以「文件信息」打开，不是默认的文本查看器
      await item('メモ.txt').click()
      await expect(tabs(page)).toHaveText(['メモ.txt'])
      await expect(info).toBeVisible()
      await expect(text).toHaveCount(0)
      // 用户选定的「文件信息」：文件有预览器，不显示「无法预览」
      await expect(info).not.toContainText("can't be previewed")

      // 双击：同一位置换成默认查看器（第一次单击已打开，不再多记一条历史）
      await item('メモ.txt').dblclick()
      await expect(text).toBeVisible()
      await expect(info).toHaveCount(0)
      await expect(tabs(page)).toHaveText(['メモ.txt'])
      await expect(backButton(page)).toBeDisabled()

      // 当前标签已在显示该文件：单击什么都不做（不切回文件信息、不进历史）
      await item('メモ.txt').click()
      await page.waitForTimeout(300)
      await expect(text).toBeVisible()
      await expect(info).toHaveCount(0)
      await expect(backButton(page)).toBeDisabled()

      // 单击另一个文件：当前标签以文件信息打开并进入历史；后退 / 前进恢复当时的查看器
      await item('README.md').click()
      await expect(tabs(page)).toHaveText(['README.md'])
      await expect(info).toBeVisible()
      await backButton(page).click()
      await expect(tabs(page)).toHaveText(['メモ.txt'])
      await expect(text).toBeVisible()
      await forwardButton.click()
      await expect(tabs(page)).toHaveText(['README.md'])
      await expect(info).toBeVisible()

      // ↓ 停留：当前标签以文件信息打开（防抖后）；Enter：同一位置换成默认查看器
      await tree.focus()
      await page.keyboard.press('ArrowDown')
      await expect(item('メモ.txt')).toHaveAttribute('aria-selected', 'true')
      await expect(tabs(page)).toHaveText(['メモ.txt'])
      await expect(info).toBeVisible()
      await page.keyboard.press('Enter')
      await expect(text).toBeVisible()
      await expect(info).toHaveCount(0)
      await expect(tabs(page)).toHaveText(['メモ.txt'])

      // ↑ 后立即 ↓ 回到正在显示的文件并停留：什么都不做（仍是默认查看器）
      await page.keyboard.press('ArrowUp')
      await page.keyboard.press('ArrowDown')
      await page.waitForTimeout(800)
      await expect(tabs(page)).toHaveText(['メモ.txt'])
      await expect(text).toBeVisible()

      // Ctrl+Enter：新标签、默认查看器（取消 ↓ 的防抖打开）
      await page.keyboard.press('ArrowDown')
      await page.keyboard.press('Control+Enter')
      await expect(tabs(page)).toHaveText(['メモ.txt', 'メモ2.txt'])
      await expect(tab(page, 'メモ2.txt')).toHaveAttribute('aria-selected', 'true')
      await expect(text).toBeVisible()
      await expect(info).toHaveCount(0)

      // Ctrl+单击：新标签、默认查看器
      await item('メモ3.txt').click({ modifiers: ['Control'] })
      await expect(tabs(page)).toHaveText(['メモ.txt', 'メモ2.txt', 'メモ3.txt'])
      await expect(tab(page, 'メモ3.txt')).toHaveAttribute('aria-selected', 'true')
      await expect(text).toBeVisible()
      await expect(info).toHaveCount(0)

      // 中键：新标签、默认查看器
      await toggleRow(item('設計書'))
      await item('v1.txt').click({ button: 'middle' })
      await expect(tabs(page)).toHaveText(['メモ.txt', 'メモ2.txt', 'メモ3.txt', 'v1.txt'])
      await expect(tab(page, 'v1.txt')).toHaveAttribute('aria-selected', 'true')
      await expect(text).toBeVisible()
      await expect(info).toHaveCount(0)
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
        await tree.getByRole('treeitem', { name }).click({ button: 'middle' })
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

  test('with explorer.singleClickPreview off a single click and the arrow keys only select; Enter and a file double click open with the default viewer', async () => {
    const { app, page } = await launchFast(userData)
    try {
      await data(page, 'settings.set', { 'explorer.singleClickPreview': false })
      const tree = await setup(page)
      const root = tree.getByRole('treeitem', { name: '案件' })
      await root.click()
      await expect(root).toHaveAttribute('aria-selected', 'true')
      await expect(root).toHaveAttribute('aria-expanded', 'false')
      // 双击目录：只展开（不打开）
      await root.dblclick()
      await expect(root).toHaveAttribute('aria-expanded', 'true')
      const readme = tree.getByRole('treeitem', { name: 'README.md' })
      const memo = tree.getByRole('treeitem', { name: 'メモ.txt' })
      await memo.click()
      await expect(memo).toHaveAttribute('aria-selected', 'true')
      // ↑↓ 只移动选中：停留超过防抖时间也不打开
      await page.keyboard.press('ArrowUp')
      await expect(memo).toHaveAttribute('aria-selected', 'false')
      await page.waitForTimeout(800)
      await expect(page.getByRole('tablist')).toHaveCount(0)
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()

      // Enter 打开（没有标签时新建，默认查看器）；文件的双击在当前标签打开
      const panel = page.getByRole('tabpanel')
      await memo.click()
      await page.keyboard.press('Enter')
      await expect(tabs(page)).toHaveText(['メモ.txt'])
      await expect(panel.getByRole('region', { name: 'File content' })).toBeVisible()
      await expect(panel.getByRole('region', { name: 'File info' })).toHaveCount(0)
      await readme.dblclick()
      await expect(tabs(page)).toHaveText(['README.md'])
    } finally {
      await app.close()
    }
  })
})
