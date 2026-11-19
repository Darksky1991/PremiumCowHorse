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

      // 目录视图进入子目录：树展开所需的祖先并选中它（子目录本身不展开），焦点留在目录视图
      await row(page, '設計書').dblclick()
      await expect(tabs(page)).toHaveText(['設計書'])
      await expect(item(tree, '案件')).toHaveAttribute('aria-expanded', 'true')
      await expect(item(tree, '設計書')).toHaveAttribute('aria-selected', 'true')
      await expect(item(tree, '設計書')).toHaveAttribute('aria-expanded', 'false')
      await row(page, 'v1').dblclick()
      await expect(item(tree, 'v1')).toHaveAttribute('aria-selected', 'true')
      await expect(item(tree, '設計書')).toHaveAttribute('aria-expanded', 'true')
      await expect(grid(page)).toBeFocused()
      // 文件也一样：目录视图双击文件在当前标签打开，树选中该文件
      await row(page, '仕様.txt').dblclick()
      await expect(tabs(page)).toHaveText(['仕様.txt'])
      await expect(item(tree, '仕様.txt')).toHaveAttribute('aria-selected', 'true')
      await expect(tree).not.toBeFocused()

      // 后退 / 前进：树跟随
      await button(page, 'Back').click()
      await expect(item(tree, 'v1')).toHaveAttribute('aria-selected', 'true')
      await page.keyboard.press('Alt+ArrowLeft')
      await expect(tabs(page)).toHaveText(['設計書'])
      await expect(item(tree, '設計書')).toHaveAttribute('aria-selected', 'true')
      await page.keyboard.press('Alt+ArrowRight')
      await expect(item(tree, 'v1')).toHaveAttribute('aria-selected', 'true')
      await expect(selectedName(tree)).toHaveCount(1)

      // 地址栏点段：树跟随
      await bar(page).getByRole('listitem').getByRole('button', { name: '案件' }).click()
      await expect(item(tree, '案件')).toHaveAttribute('aria-selected', 'true')

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
