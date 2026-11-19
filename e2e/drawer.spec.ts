import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { data, launchFast, removeDirs, toggleRow } from './support'

/** 资源树标题栏（全部折叠、定位到当前项）与分组抽屉（设计 devDoc/2026-11-19-15 第 2.7 节） */
test.describe('explorer toolbar and group drawers', () => {
  let userData: string
  let files: string
  let project: string
  let ops: string

  test.beforeEach(() => {
    userData = mkdtempSync(path.join(tmpdir(), 'pch-e2e-'))
    files = mkdtempSync(path.join(tmpdir(), 'pch-e2e-files-'))
    project = path.join(files, '案件')
    ops = path.join(files, '保守')
    mkdirSync(path.join(project, '設計書', 'v1'), { recursive: true })
    writeFileSync(path.join(project, '設計書', 'v1', '仕様.txt'), 'spec')
    mkdirSync(path.join(ops, '手順書'), { recursive: true })
  })
  test.afterEach(() => {
    removeDirs(userData, files)
  })

  /** 界面语言设为 en，返回工作区 id 与树 */
  async function setup(page: Page): Promise<{ workspaceId: string; tree: Locator }> {
    await data(page, 'settings.set', { 'general.language': 'en' })
    await expect(page.locator('html')).toHaveAttribute('lang', 'en')
    const { id: workspaceId } = await data(page, 'workspace.active')
    return { workspaceId, tree: page.getByRole('tree') }
  }

  const item = (tree: Locator, name: string): Locator =>
    tree.getByRole('treeitem', { name, exact: true })
  const rowNames = (tree: Locator): Locator => tree.getByRole('treeitem')
  const selected = (tree: Locator): Locator =>
    tree.locator('[role="treeitem"][aria-selected="true"]')
  const collapseAll = (page: Page): Locator =>
    page.getByRole('button', { name: 'Collapse all', exact: true })
  const locate = (page: Page): Locator =>
    page.getByRole('button', { name: 'Reveal active item', exact: true })

  test('collapse all closes every directory and keeps the selection; locate reveals the active tab again', async () => {
    const { app, page } = await launchFast(userData)
    try {
      const { workspaceId, tree } = await setup(page)
      // 没有标签时「定位」不可用
      await expect(locate(page)).toBeDisabled()
      await data(page, 'entry.add', { kind: 'folder', workspaceId, parentId: null, path: project })
      await toggleRow(item(tree, '案件'))
      await toggleRow(item(tree, '設計書'))
      // 打开深层目录（单击 = 在当前标签打开）
      await item(tree, 'v1').click()
      await expect(page.getByRole('tablist').getByRole('tab')).toHaveText(['v1'])
      await expect(item(tree, 'v1')).toHaveAttribute('aria-selected', 'true')

      await collapseAll(page).click()
      await expect(rowNames(tree)).toHaveText(['案件'])
      await expect(item(tree, '案件')).toHaveAttribute('aria-expanded', 'false')
      // 选中没有被清除：被折叠挡住时显示为可见的祖先选中
      await expect(selected(tree)).toHaveText(['案件'])

      // 定位：展开祖先、选中激活标签的位置、焦点移到树上
      await expect(locate(page)).toBeEnabled()
      await locate(page).click()
      await expect(item(tree, 'v1')).toHaveAttribute('aria-selected', 'true')
      await expect(item(tree, '案件')).toHaveAttribute('aria-expanded', 'true')
      await expect(item(tree, '設計書')).toHaveAttribute('aria-expanded', 'true')
      await expect(tree).toBeFocused()

      // 再次全部折叠后，手动展开回去：原来的选中项恢复
      await collapseAll(page).click()
      await toggleRow(item(tree, '案件'))
      await toggleRow(item(tree, '設計書'))
      await expect(selected(tree)).toHaveText(['v1'])
    } finally {
      await app.close()
    }
  })

  test('group drawers: ungrouped entries stay on top, only one top-level group is open, a reopened group keeps its expansion and selection', async () => {
    const { app, page } = await launchFast(userData)
    try {
      const { workspaceId, tree } = await setup(page)
      // 分组先于未分组的条目创建（sortOrder 更小）：显示时未分组的条目仍在分组之上
      const groupA = await data(page, 'entry.add', {
        kind: 'group',
        workspaceId,
        parentId: null,
        label: 'Group A'
      })
      const groupB = await data(page, 'entry.add', {
        kind: 'group',
        workspaceId,
        parentId: null,
        label: 'Group B'
      })
      await data(page, 'entry.add', {
        kind: 'folder',
        workspaceId,
        parentId: groupA.id,
        path: project
      })
      await data(page, 'entry.add', { kind: 'folder', workspaceId, parentId: groupB.id, path: ops })
      await data(page, 'entry.add', {
        kind: 'file',
        workspaceId,
        parentId: null,
        path: path.join(project, '設計書', 'v1', '仕様.txt'),
        label: 'Pinned'
      })
      await expect(rowNames(tree)).toHaveText(['Pinned', 'Group A', 'Group B'])

      // 分组标题单击 = 展开（不改变选中）；在 A 中展开目录并选中其中一项
      await item(tree, 'Group A').click()
      await expect(item(tree, 'Group A')).toHaveAttribute('aria-expanded', 'true')
      await toggleRow(item(tree, '案件'))
      await item(tree, '設計書').click()
      await expect(item(tree, '設計書')).toHaveAttribute('aria-selected', 'true')
      await expect(rowNames(tree)).toHaveText(['Pinned', 'Group A', '案件', '設計書', 'Group B'])

      // 展开 B → A 收起；未分组的条目始终可见
      await item(tree, 'Group B').click()
      await expect(item(tree, 'Group A')).toHaveAttribute('aria-expanded', 'false')
      await expect(item(tree, 'Group B')).toHaveAttribute('aria-expanded', 'true')
      await expect(rowNames(tree)).toHaveText(['Pinned', 'Group A', 'Group B', '保守'])
      // 被收起分组内的选中项：显示为该分组选中
      await expect(selected(tree)).toHaveText(['Group A'])

      // 重新展开 A → B 收起，A 内部的展开状态与选中恢复
      await item(tree, 'Group A').click()
      await expect(item(tree, 'Group B')).toHaveAttribute('aria-expanded', 'false')
      await expect(rowNames(tree)).toHaveText(['Pinned', 'Group A', '案件', '設計書', 'Group B'])
      await expect(selected(tree)).toHaveText(['設計書'])

      // 键盘：↑↓ 能遍历分组标题，→ / ← 展开 / 收起（同样互斥）
      await tree.focus()
      await page.keyboard.press('ArrowDown')
      await expect(selected(tree)).toHaveText(['Group B'])
      await page.keyboard.press('ArrowRight')
      await expect(item(tree, 'Group B')).toHaveAttribute('aria-expanded', 'true')
      await expect(item(tree, 'Group A')).toHaveAttribute('aria-expanded', 'false')

      // 定位到当前项（激活标签为 A 中的「設計書」）：进入被收起的 A，B 收起
      await locate(page).click()
      await expect(item(tree, 'Group A')).toHaveAttribute('aria-expanded', 'true')
      await expect(item(tree, 'Group B')).toHaveAttribute('aria-expanded', 'false')
      await expect(item(tree, '設計書')).toHaveAttribute('aria-selected', 'true')

      // 全部折叠：顶层分组也收起
      await collapseAll(page).click()
      await expect(rowNames(tree)).toHaveText(['Pinned', 'Group A', 'Group B'])
    } finally {
      await app.close()
    }
  })
})
