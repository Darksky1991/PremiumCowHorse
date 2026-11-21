import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { data, launchFast, removeDirs, toggleRow } from './support'

/** 资源树 ↔ 地址栏 ↔ 预览区的同步（设计 devDoc/2026-11-19-15 第 2.4 / 2.8 节） */
test.describe('the tree follows the tabs', () => {
  let userData: string
  let files: string
  let project: string

  test.beforeEach(() => {
    userData = mkdtempSync(path.join(tmpdir(), 'pch-e2e-'))
    files = mkdtempSync(path.join(tmpdir(), 'pch-e2e-files-'))
    project = path.join(files, '案件')
    mkdirSync(path.join(project, '設計書', 'v1'), { recursive: true })
    writeFileSync(path.join(project, '設計書', 'v1', '仕様.txt'), 'spec')
    for (const name of ['a.txt', 'b.txt', 'c.txt', 'd.txt', 'e.txt']) {
      writeFileSync(path.join(project, name), name)
    }
  })
  test.afterEach(() => {
    removeDirs(userData, files)
  })

  /** 界面语言设为 en，添加条目「案件」，返回工作区 id 与树 */
  async function setup(page: Page): Promise<{ workspaceId: string; tree: Locator }> {
    await data(page, 'settings.set', { 'general.language': 'en' })
    await expect(page.locator('html')).toHaveAttribute('lang', 'en')
    const { id: workspaceId } = await data(page, 'workspace.active')
    await data(page, 'entry.add', { kind: 'folder', workspaceId, parentId: null, path: project })
    const tree = page.getByRole('tree')
    await expect(tree.getByRole('treeitem', { name: '案件' })).toBeVisible()
    return { workspaceId, tree }
  }

  const tabs = (page: Page): Locator => page.getByRole('tablist').getByRole('tab')
  const tab = (page: Page, name: string): Locator =>
    page.getByRole('tablist').getByRole('tab', { name, exact: true })
  const bar = (page: Page): Locator => page.getByRole('navigation', { name: 'Address bar' })
  const button = (page: Page, name: string): Locator =>
    bar(page).getByRole('button', { name, exact: true })
  const grid = (page: Page): Locator => page.getByRole('tabpanel').getByRole('grid')
  const row = (page: Page, name: string): Locator =>
    grid(page)
      .locator('[role="row"][data-index]')
      .filter({ has: page.getByTitle(name, { exact: true }) })
  const item = (tree: Locator, name: string): Locator =>
    tree.getByRole('treeitem', { name, exact: true })
  const selectedName = (tree: Locator): Locator =>
    tree.locator('[role="treeitem"][aria-selected="true"]')

  test('entering sub-directories in the directory view, back / forward and switching tabs select the location in the tree; the overview keeps the selection', async () => {
    const { app, page } = await launchFast(userData)
    try {
      const { tree } = await setup(page)
      await item(tree, '案件').click()
      await expect(tabs(page)).toHaveText(['案件'])
      await expect(item(tree, '案件')).toHaveAttribute('aria-expanded', 'false')

      // 目录视图进入子目录（条目根折叠时）：树展开祖先、选中该目录并滚动到可见，该目录本身也展开
      // （与目录视图显示的内容一致，第 5 项反馈）；焦点留在目录视图
      await row(page, '設計書').dblclick()
      await expect(tabs(page)).toHaveText(['設計書'])
      await expect(item(tree, '案件')).toHaveAttribute('aria-expanded', 'true')
      await expect(item(tree, '設計書')).toHaveAttribute('aria-selected', 'true')
      await expect(item(tree, '設計書')).toHaveAttribute('aria-expanded', 'true')
      await expect(item(tree, '設計書')).toBeInViewport()
      await expect(item(tree, 'v1')).toBeVisible()
      // 再进入孙目录：同样选中并展开
      await row(page, 'v1').dblclick()
      await expect(item(tree, 'v1')).toHaveAttribute('aria-selected', 'true')
      await expect(item(tree, 'v1')).toHaveAttribute('aria-expanded', 'true')
      await expect(item(tree, '仕様.txt')).toBeVisible()
      await expect(grid(page)).toBeFocused()
      // 文件：目录视图双击文件在当前标签打开，树只展开祖先、选中该文件
      await row(page, '仕様.txt').dblclick()
      await expect(tabs(page)).toHaveText(['仕様.txt'])
      await expect(item(tree, '仕様.txt')).toHaveAttribute('aria-selected', 'true')
      await expect(item(tree, 'v1')).toHaveAttribute('aria-expanded', 'true')
      await expect(tree).not.toBeFocused()

      // 后退 / 前进：树跟随；离开的目录（跟随展开的）收起，后退时树不越展越多
      await button(page, 'Back').click()
      await expect(item(tree, 'v1')).toHaveAttribute('aria-selected', 'true')
      await page.keyboard.press('Alt+ArrowLeft')
      await expect(tabs(page)).toHaveText(['設計書'])
      await expect(item(tree, '設計書')).toHaveAttribute('aria-selected', 'true')
      await expect(item(tree, '設計書')).toHaveAttribute('aria-expanded', 'true')
      await expect(item(tree, 'v1')).toHaveAttribute('aria-expanded', 'false')
      await page.keyboard.press('Alt+ArrowRight')
      await expect(item(tree, 'v1')).toHaveAttribute('aria-selected', 'true')
      await expect(item(tree, 'v1')).toHaveAttribute('aria-expanded', 'true')
      await expect(selectedName(tree)).toHaveCount(1)

      // 地址栏点段：树跟随（跟随展开的 設計書、v1 收起；作为祖先展开的条目根保持展开）
      await bar(page).getByRole('listitem').getByRole('button', { name: '案件' }).click()
      await expect(item(tree, '案件')).toHaveAttribute('aria-selected', 'true')
      await expect(item(tree, '案件')).toHaveAttribute('aria-expanded', 'true')
      await expect(item(tree, '設計書')).toHaveAttribute('aria-expanded', 'false')
      await expect(item(tree, 'v1')).toHaveCount(0)

      // 新标签与切换标签：树选中激活标签的位置
      await item(tree, 'c.txt').click({ button: 'middle' })
      await expect(tabs(page)).toHaveText(['案件', 'c.txt'])
      await expect(item(tree, 'c.txt')).toHaveAttribute('aria-selected', 'true')
      await tab(page, '案件').click()
      await expect(item(tree, '案件')).toHaveAttribute('aria-selected', 'true')
      await tab(page, 'c.txt').click()
      await expect(item(tree, 'c.txt')).toHaveAttribute('aria-selected', 'true')

      // 上一级：树跟随；工作区总览（不在树中）：树的选中保持不变
      await button(page, 'Up one level').click()
      await expect(tabs(page)).toHaveText(['案件', '案件'])
      await expect(item(tree, '案件')).toHaveAttribute('aria-selected', 'true')
      await button(page, 'Up one level').click()
      await expect(tabs(page)).toHaveText(['案件', 'Default'])
      await page.waitForTimeout(300)
      await expect(item(tree, '案件')).toHaveAttribute('aria-selected', 'true')
      await expect(selectedName(tree)).toHaveCount(1)
    } finally {
      await app.close()
    }
  })

  test('with the entry root already expanded the tree also follows into sub-directories; directories the user expanded stay open, a tree click on a directory still does not expand it', async () => {
    const { app, page } = await launchFast(userData)
    try {
      const { tree } = await setup(page)
      await toggleRow(item(tree, '案件'))
      await expect(item(tree, '設計書')).toBeVisible()
      await item(tree, '案件').click()
      await expect(tabs(page)).toHaveText(['案件'])

      await row(page, '設計書').dblclick()
      await expect(tabs(page)).toHaveText(['設計書'])
      await expect(item(tree, '設計書')).toHaveAttribute('aria-selected', 'true')
      await expect(item(tree, '設計書')).toHaveAttribute('aria-expanded', 'true')
      await row(page, 'v1').dblclick()
      await expect(item(tree, 'v1')).toHaveAttribute('aria-selected', 'true')
      await expect(item(tree, 'v1')).toHaveAttribute('aria-expanded', 'true')
      await expect(item(tree, '仕様.txt')).toBeInViewport()
      await expect(tree).not.toBeFocused()

      // 地址栏回到条目根：跟随展开的目录都收起
      await bar(page).getByRole('listitem').getByRole('button', { name: '案件' }).click()
      await expect(item(tree, '案件')).toHaveAttribute('aria-selected', 'true')
      await expect(item(tree, '設計書')).toHaveAttribute('aria-expanded', 'false')

      // 用户自己展开的目录：离开时不替用户收起
      await toggleRow(item(tree, '設計書'))
      await expect(item(tree, '設計書')).toHaveAttribute('aria-expanded', 'true')
      await row(page, '設計書').dblclick()
      await expect(item(tree, '設計書')).toHaveAttribute('aria-selected', 'true')
      await row(page, 'v1').dblclick()
      await expect(item(tree, 'v1')).toHaveAttribute('aria-expanded', 'true')
      await page.keyboard.press('Alt+ArrowLeft')
      await expect(tabs(page)).toHaveText(['設計書'])
      await expect(item(tree, 'v1')).toHaveAttribute('aria-expanded', 'false')
      await page.keyboard.press('Alt+ArrowLeft')
      await expect(tabs(page)).toHaveText(['案件'])
      await expect(item(tree, '案件')).toHaveAttribute('aria-selected', 'true')
      await expect(item(tree, '設計書')).toHaveAttribute('aria-expanded', 'true')

      // 树中单击目录：在当前标签打开、选中，但不展开（需求 7 不变）
      await item(tree, 'v1').click()
      await expect(tabs(page)).toHaveText(['v1'])
      await expect(item(tree, 'v1')).toHaveAttribute('aria-selected', 'true')
      await page.waitForTimeout(300)
      await expect(item(tree, 'v1')).toHaveAttribute('aria-expanded', 'false')
    } finally {
      await app.close()
    }
  })

  test('a tree click moves no rows: the followed directory stays open until the next sync driven by the tab, which collapses it', async () => {
    mkdirSync(path.join(project, '議事録', '2024'), { recursive: true })
    const { app, page } = await launchFast(userData)
    try {
      const { tree } = await setup(page)
      await item(tree, '案件').click()
      await expect(tabs(page)).toHaveText(['案件'])
      await row(page, '設計書').dblclick()
      await expect(item(tree, '設計書')).toHaveAttribute('aria-expanded', 'true')

      // 树中单击另一个目录（同步跳过）：設計書 不在点击时收起（行不在指针下移动）
      await item(tree, '議事録').click()
      await expect(tabs(page)).toHaveText(['議事録'])
      await page.waitForTimeout(300)
      await expect(item(tree, '設計書')).toHaveAttribute('aria-expanded', 'true')
      // 之后经目录视图进入子目录（由标签驱动的同步）：跟随展开的 設計書 收起，树不越积越多
      await row(page, '2024').dblclick()
      await expect(item(tree, '2024')).toHaveAttribute('aria-selected', 'true')
      await expect(item(tree, '設計書')).toHaveAttribute('aria-expanded', 'false')
    } finally {
      await app.close()
    }
  })

  test('directories the sync expanded as ancestors collapse again when the tab leaves them', async () => {
    mkdirSync(path.join(project, '議事録', '2024'), { recursive: true })
    const { app, page } = await launchFast(userData)
    try {
      const { tree } = await setup(page)
      // 条目根由用户展开；树中单击 議事録（需求 7：不展开）
      await toggleRow(item(tree, '案件'))
      await item(tree, '案件').click()
      await item(tree, '議事録').click()
      await expect(tabs(page)).toHaveText(['議事録'])
      await expect(item(tree, '議事録')).toHaveAttribute('aria-expanded', 'false')

      // 目录视图进入 2024：議事録 作为祖先展开、2024 本身展开
      await row(page, '2024').dblclick()
      await expect(item(tree, '2024')).toHaveAttribute('aria-selected', 'true')
      await expect(item(tree, '議事録')).toHaveAttribute('aria-expanded', 'true')
      // 后退到 議事録：2024 收起，議事録（目标）保持展开
      await button(page, 'Back').click()
      await expect(item(tree, '議事録')).toHaveAttribute('aria-selected', 'true')
      await expect(item(tree, '2024')).toHaveAttribute('aria-expanded', 'false')
      await expect(item(tree, '議事録')).toHaveAttribute('aria-expanded', 'true')
      // 再后退到条目根：同步展开的 議事録 也收起；用户展开的条目根保持
      await button(page, 'Back').click()
      await expect(item(tree, '案件')).toHaveAttribute('aria-selected', 'true')
      await expect(item(tree, '議事録')).toHaveAttribute('aria-expanded', 'false')
      await expect(item(tree, '案件')).toHaveAttribute('aria-expanded', 'true')
    } finally {
      await app.close()
    }
  })

  test('after quick arrow presses only the last stop opens, 400ms later, as one history entry', async () => {
    const { app, page } = await launchFast(userData)
    try {
      const { tree } = await setup(page)
      await toggleRow(item(tree, '案件'))
      await expect(item(tree, 'a.txt')).toBeVisible()
      await item(tree, 'a.txt').click()
      await expect(tabs(page)).toHaveText(['a.txt'])
      await expect(button(page, 'Back')).toBeDisabled()

      // a → b → c → d 快速连按：最后停留在 d；防抖期间标签不变
      await tree.focus()
      for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowDown')
      await expect(item(tree, 'd.txt')).toHaveAttribute('aria-selected', 'true')
      await expect(tabs(page)).toHaveText(['a.txt'])
      // 400ms 后在当前标签打开 d（只打开一次）
      await expect(tabs(page)).toHaveText(['d.txt'])
      await expect(item(tree, 'd.txt')).toHaveAttribute('aria-selected', 'true')
      // 历史只多一条：后退一次回到 a，之后不能再后退；前进回到 d
      await button(page, 'Back').click()
      await expect(tabs(page)).toHaveText(['a.txt'])
      await expect(button(page, 'Back')).toBeDisabled()
      await expect(item(tree, 'a.txt')).toHaveAttribute('aria-selected', 'true')
      await button(page, 'Forward').click()
      await expect(tabs(page)).toHaveText(['d.txt'])
      await expect(button(page, 'Forward')).toBeDisabled()

      // 停留期间标签被其他操作改变（后退）：之前的 ↑↓ 打开作废
      await tree.focus()
      await page.keyboard.press('ArrowDown')
      await page.keyboard.press('Alt+ArrowLeft')
      await expect(tabs(page)).toHaveText(['a.txt'])
      await page.waitForTimeout(800)
      await expect(tabs(page)).toHaveText(['a.txt'])
      await expect(item(tree, 'a.txt')).toHaveAttribute('aria-selected', 'true')
    } finally {
      await app.close()
    }
  })

  test('the sync does not loop: one click is one open, then the tree, the tab and the address bar stay still', async () => {
    const { app, page } = await launchFast(userData)
    try {
      const { workspaceId, tree } = await setup(page)
      // 同一文件在树中出现两次（folder 条目内的 b.txt 与固定在根部的 file 条目「ピン」）
      await data(page, 'entry.add', {
        kind: 'file',
        workspaceId,
        parentId: null,
        path: path.join(project, 'b.txt'),
        label: 'ピン'
      })
      await toggleRow(item(tree, '案件'))
      await expect(item(tree, 'b.txt')).toBeVisible()
      await item(tree, 'a.txt').click()
      await expect(tabs(page)).toHaveText(['a.txt'])

      // 从这里开始计数：树的选中变化、标签标题变化、地址栏最后一段的变化
      await page.evaluate(() => {
        const w = window as unknown as { counts: Record<string, number> }
        w.counts = { selected: 0, tab: 0, address: 0 }
        const watch = (selector: string, key: string, options: MutationObserverInit): void => {
          new MutationObserver((records) => {
            w.counts[key]! += records.length
          }).observe(document.querySelector(selector)!, options)
        }
        watch('[role="tree"]', 'selected', {
          subtree: true,
          attributes: true,
          attributeFilter: ['aria-selected']
        })
        watch('[role="tablist"]', 'tab', { subtree: true, childList: true, characterData: true })
        watch('nav[aria-label="Address bar"] ol', 'address', {
          subtree: true,
          childList: true,
          characterData: true
        })
      })
      const counts = (): Promise<Record<string, number>> =>
        page.evaluate(() => (window as unknown as { counts: Record<string, number> }).counts)

      await item(tree, 'b.txt').click()
      await expect(tabs(page)).toHaveText(['b.txt'])
      // 选中留在用户单击的那一行（同一 URI 的另一行「ピン」不被选中）
      await expect(item(tree, 'b.txt')).toHaveAttribute('aria-selected', 'true')
      await expect(item(tree, 'ピン')).toHaveAttribute('aria-selected', 'false')
      await page.waitForTimeout(300)
      const settled = await counts()
      // 选中只变化一次：a 取消（1 次属性变化）+ b 选中（1 次）
      expect(settled.selected).toBe(2)
      // 稳定之后不再变化（没有「打开 → 同步选中 → 再打开」的循环）
      await page.waitForTimeout(1500)
      expect(await counts()).toEqual(settled)
      // 打开只发生一次：历史只多一条
      await button(page, 'Back').click()
      await expect(tabs(page)).toHaveText(['a.txt'])
      await expect(button(page, 'Back')).toBeDisabled()
    } finally {
      await app.close()
    }
  })
})
