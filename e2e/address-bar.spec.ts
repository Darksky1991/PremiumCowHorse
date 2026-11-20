import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { data, launchFast, removeDirs } from './support'

test.describe('the application address bar', () => {
  let userData: string
  let files: string
  let project: string

  test.beforeEach(() => {
    userData = mkdtempSync(path.join(tmpdir(), 'pch-e2e-'))
    files = mkdtempSync(path.join(tmpdir(), 'pch-e2e-files-'))
    project = path.join(files, '案件')
    mkdirSync(path.join(project, '設計書'), { recursive: true })
    writeFileSync(path.join(project, '設計書', 'v1.txt'), 'v1')
    writeFileSync(path.join(project, 'memo.txt'), 'memo')
  })
  test.afterEach(() => {
    removeDirs(userData, files)
  })

  /** 界面语言设为 en（断言固定文案），添加条目「案件」，返回条目与树 */
  async function setup(page: Page): Promise<{ entryId: string; tree: Locator }> {
    await data(page, 'settings.set', { 'general.language': 'en' })
    await expect(page.locator('html')).toHaveAttribute('lang', 'en')
    const { id: workspaceId } = await data(page, 'workspace.active')
    const entry = await data(page, 'entry.add', {
      kind: 'folder',
      workspaceId,
      parentId: null,
      path: project
    })
    const tree = page.getByRole('tree')
    await expect(tree.getByRole('treeitem', { name: '案件' })).toBeVisible()
    return { entryId: entry.id, tree }
  }

  const bar = (page: Page): Locator => page.getByRole('navigation', { name: 'Address bar' })
  /** 路径的各段（工作区段的文字不含下拉按钮） */
  const segments = (page: Page): Locator => bar(page).getByRole('listitem')
  const segment = (page: Page, name: string): Locator =>
    segments(page).getByRole('button', { name, exact: true })
  const button = (page: Page, name: string): Locator =>
    bar(page).getByRole('button', { name, exact: true })
  const tabs = (page: Page): Locator => page.getByRole('tablist').getByRole('tab')
  const panel = (page: Page): Locator => page.getByRole('tabpanel')
  const grid = (page: Page): Locator => panel(page).getByRole('grid')
  const row = (page: Page, name: string): Locator =>
    grid(page)
      .locator('[role="row"][data-index]')
      .filter({ has: page.getByTitle(name, { exact: true }) })

  test('shows the logical path of the active tab; segments, back / forward / up, Alt+← / Alt+→ and the mouse side buttons navigate the tab', async () => {
    const { app, page } = await launchFast(userData)
    try {
      const { tree } = await setup(page)
      // 没有标签：只有工作区一段，按钮不可用
      await expect(segments(page)).toHaveText(['Default'])
      for (const name of ['Back', 'Forward', 'Up one level', 'Refresh']) {
        await expect(button(page, name)).toBeDisabled()
      }

      await tree.getByRole('treeitem', { name: '案件' }).dblclick()
      await expect(segments(page)).toHaveText(['Default', '案件'])
      await row(page, '設計書').dblclick()
      await expect(tabs(page)).toHaveText(['設計書'])
      await expect(segments(page)).toHaveText(['Default', '案件', '設計書'])
      // 当前位置为最后一段；悬停提示为真实路径（工作区段没有）
      await expect(segment(page, '設計書')).toHaveAttribute('aria-current', 'location')
      await expect(segment(page, '設計書')).toHaveAttribute('title', path.join(project, '設計書'))
      await expect(segment(page, '案件')).toHaveAttribute('title', project)
      await expect(segment(page, 'Default')).not.toHaveAttribute('title')
      await expect(button(page, 'Back')).toBeEnabled()
      await expect(button(page, 'Forward')).toBeDisabled()

      // 单击段：在当前标签内导航（进入历史）
      await segment(page, '案件').click()
      await expect(tabs(page)).toHaveText(['案件'])
      await expect(segments(page)).toHaveText(['Default', '案件'])

      // 后退 / 前进按钮
      await button(page, 'Back').click()
      await expect(tabs(page)).toHaveText(['設計書'])
      await button(page, 'Back').click()
      await expect(tabs(page)).toHaveText(['案件'])
      await expect(button(page, 'Back')).toBeDisabled()
      await button(page, 'Forward').click()
      await expect(tabs(page)).toHaveText(['設計書'])

      // Alt+← / Alt+→（焦点在目录视图）
      await grid(page).focus()
      await page.keyboard.press('Alt+ArrowLeft')
      await expect(tabs(page)).toHaveText(['案件'])
      await page.keyboard.press('Alt+ArrowRight')
      await expect(tabs(page)).toHaveText(['設計書'])

      // 鼠标侧键（mouseup 的 button 3 / 4；Playwright 不能按下侧键，以 DOM 事件发出）
      await grid(page).dispatchEvent('mouseup', { button: 3 })
      await expect(tabs(page)).toHaveText(['案件'])
      await grid(page).dispatchEvent('mouseup', { button: 4 })
      await expect(tabs(page)).toHaveText(['設計書'])

      // 上一级：条目内逐级向上，条目根之上是工作区总览；总览没有上一级
      await button(page, 'Up one level').click()
      await expect(tabs(page)).toHaveText(['案件'])
      await button(page, 'Up one level').click()
      await expect(tabs(page)).toHaveText(['Default'])
      await expect(segments(page)).toHaveText(['Default'])
      await expect(button(page, 'Up one level')).toBeDisabled()
    } finally {
      await app.close()
    }
  })

  test('a file tab shows the file name; middle click and Ctrl+click open a segment in a new tab; without tabs the workspace segment opens the overview', async () => {
    const { app, page } = await launchFast(userData)
    try {
      await setup(page)
      // 没有标签时单击工作区段：新建一个标签（工作区总览）
      await segment(page, 'Default').click()
      await expect(tabs(page)).toHaveText(['Default'])
      await panel(page).getByRole('button', { name: '案件' }).dblclick()
      await row(page, '設計書').dblclick()
      // 目录视图双击文件：在当前标签打开（M1-3b 设计 2.8）
      await row(page, 'v1.txt').dblclick()
      await expect(tabs(page)).toHaveText(['v1.txt'])
      await expect(segments(page)).toHaveText(['Default', '案件', '設計書', 'v1.txt'])
      await expect(segment(page, 'v1.txt')).toHaveAttribute(
        'title',
        path.join(project, '設計書', 'v1.txt')
      )

      // 中键 / Ctrl+单击：在新标签打开（当前标签不变）
      await segment(page, '案件').click({ button: 'middle' })
      await expect(tabs(page)).toHaveText(['v1.txt', '案件'])
      await expect(segments(page)).toHaveText(['Default', '案件'])
      await page.getByRole('tablist').getByRole('tab', { name: 'v1.txt' }).click()
      await segment(page, 'Default').click({ modifiers: ['Control'] })
      await expect(tabs(page)).toHaveText(['v1.txt', 'Default', '案件'])
      await expect(segments(page)).toHaveText(['Default'])
    } finally {
      await app.close()
    }
  })

  test('the workspace menu switches workspaces; renaming an entry updates its alias in the address bar', async () => {
    const { app, page } = await launchFast(userData)
    try {
      const { entryId, tree } = await setup(page)
      await data(page, 'workspace.create', { name: '別件' })
      await tree.getByRole('treeitem', { name: '案件' }).dblclick()
      await row(page, '設計書').dblclick()
      await expect(segments(page)).toHaveText(['Default', '案件', '設計書'])

      // 别名：条目重命名后地址栏随之更新（标签标题是快照，不在本用例中断言）
      await data(page, 'entry.update', { id: entryId, label: '本番' })
      await expect(segments(page)).toHaveText(['Default', '本番', '設計書'])
      await expect(segment(page, '本番')).toHaveAttribute('title', project)

      // 工作区段的下拉：切换工作区（与标题栏的切换器相同）
      await button(page, 'Switch workspace').click()
      await page.getByRole('menuitemradio', { name: '別件' }).click()
      await expect(
        page.getByRole('banner').getByRole('button', { name: 'Switch workspace' })
      ).toHaveText('別件')
      await expect(segments(page)).toHaveText(['別件'])
      await expect(page.getByRole('tablist')).toHaveCount(0)

      // 切回：该工作区的标签仍在
      await button(page, 'Switch workspace').click()
      await page.getByRole('menuitemradio', { name: 'Default' }).click()
      await expect(segments(page)).toHaveText(['Default', '本番', '設計書'])
      await expect(tabs(page)).toHaveText(['設計書'])
    } finally {
      await app.close()
    }
  })

  test('while a modal dialog is open, Alt+← / Alt+→ and the side buttons do not act on the tab behind it', async () => {
    const { app, page } = await launchFast(userData)
    try {
      const { tree } = await setup(page)
      await tree.getByRole('treeitem', { name: '案件' }).dblclick()
      await row(page, '設計書').dblclick()
      await button(page, 'Back').click()
      await expect(tabs(page)).toHaveText(['案件'])

      // 右键菜单「重命名」打开对话框（焦点在输入框）
      await tree.getByRole('treeitem', { name: '案件' }).click({ button: 'right' })
      await page.getByRole('menuitem', { name: /^Rename/ }).click()
      const dialog = page.getByRole('dialog')
      await expect(dialog.getByRole('textbox')).toBeFocused()
      await page.keyboard.press('Alt+ArrowRight')
      await dialog.dispatchEvent('mouseup', { button: 3 })
      await dialog.dispatchEvent('mouseup', { button: 4 })
      // 命令是同步执行的：稍等后对话框仍打开；关闭后标签仍在原位置
      // （模态对话框打开时背后的内容对无障碍树隐藏，关闭后再断言标签）
      await page.waitForTimeout(300)
      await expect(dialog).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(dialog).toHaveCount(0)
      await expect(tabs(page)).toHaveText(['案件'])

      // 关闭对话框后恢复生效
      await page.keyboard.press('Alt+ArrowRight')
      await expect(tabs(page)).toHaveText(['設計書'])
    } finally {
      await app.close()
    }
  })
})
