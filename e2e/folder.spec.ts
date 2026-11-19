import { appendFileSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { data, launch, launchFast, removeDirs } from './support'

test.describe('folder view (the folder plugin)', () => {
  let userData: string
  let files: string
  let project: string

  test.beforeEach(() => {
    userData = mkdtempSync(path.join(tmpdir(), 'pch-e2e-'))
    files = mkdtempSync(path.join(tmpdir(), 'pch-e2e-files-'))
    project = path.join(files, '案件')
    mkdirSync(path.join(project, '設計書'), { recursive: true })
    writeFileSync(path.join(project, '設計書', 'v1.txt'), 'v1')
    writeFileSync(path.join(project, 'memo.txt'), 'x'.repeat(1536))
    writeFileSync(path.join(project, 'file2.txt'), 'x'.repeat(10))
    writeFileSync(path.join(project, 'file10.txt'), 'x'.repeat(5))
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
  const panel = (page: Page): Locator => page.getByRole('tabpanel')
  const grid = (page: Page): Locator => panel(page).getByRole('grid')
  /** 列表的数据行（不含表头） */
  const rows = (page: Page): Locator => grid(page).locator('[role="row"][data-index]')
  const row = (page: Page, name: string): Locator =>
    rows(page).filter({ has: page.getByTitle(name, { exact: true }) })
  /** 各行第一列（名称） */
  const names = (page: Page): Locator => rows(page).locator('[role="gridcell"]:first-child')
  const crumbs = (page: Page): Locator => panel(page).getByRole('navigation', { name: 'Location' })

  test('lists names, modified times, types and sizes; headers sort with folders first', async () => {
    const { app, page } = await launchFast(userData)
    try {
      const tree = await setup(page)
      await tree.getByRole('treeitem', { name: '案件' }).dblclick()
      await expect(tabs(page)).toHaveText(['案件'])

      // 默认按名称升序（数字按数值），目录在前
      await expect(names(page)).toHaveText(['設計書', 'file2.txt', 'file10.txt', 'memo.txt'])
      const memo = row(page, 'memo.txt').getByRole('gridcell')
      const expectedTime = await page.evaluate(
        (ms) =>
          new Intl.DateTimeFormat('en', { dateStyle: 'short', timeStyle: 'short' }).format(ms),
        statSync(path.join(project, 'memo.txt')).mtimeMs
      )
      await expect(memo).toHaveText(['memo.txt', expectedTime, 'TXT file', '1.5 kB'])
      // 目录不显示大小
      await expect(row(page, '設計書').getByRole('gridcell')).toHaveText([
        '設計書',
        /\d/,
        'Folder',
        ''
      ])
      await expect(panel(page).getByRole('status').last()).toContainText('4 items')

      // 列头排序：同一列再点一次反转；目录始终在前
      const nameHeader = grid(page).getByRole('columnheader', { name: 'Name' })
      await expect(nameHeader).toHaveAttribute('aria-sort', 'ascending')
      await nameHeader.getByRole('button').click()
      await expect(nameHeader).toHaveAttribute('aria-sort', 'descending')
      await expect(names(page)).toHaveText(['設計書', 'memo.txt', 'file10.txt', 'file2.txt'])
      const sizeHeader = grid(page).getByRole('columnheader', { name: 'Size' })
      await sizeHeader.getByRole('button').click()
      await expect(sizeHeader).toHaveAttribute('aria-sort', 'ascending')
      await expect(nameHeader).toHaveAttribute('aria-sort', 'none')
      await expect(names(page)).toHaveText(['設計書', 'file10.txt', 'file2.txt', 'memo.txt'])
    } finally {
      await app.close()
    }
  })

  test('double click navigates in the same tab; breadcrumb, up and Backspace go back; files open in a new tab', async () => {
    const { app, page } = await launchFast(userData)
    try {
      const tree = await setup(page)
      await tree.getByRole('treeitem', { name: '案件' }).dblclick()
      // 面包屑从条目根开始
      await expect(crumbs(page).getByRole('listitem')).toHaveText(['案件'])

      await row(page, '設計書').dblclick()
      await expect(tabs(page)).toHaveText(['設計書'])
      await expect(names(page)).toHaveText(['v1.txt'])
      await expect(crumbs(page).getByRole('listitem')).toHaveText(['案件', '設計書'])

      // 面包屑返回
      await crumbs(page).getByRole('button', { name: '案件' }).click()
      await expect(tabs(page)).toHaveText(['案件'])
      await expect(names(page)).toHaveText(['設計書', 'file2.txt', 'file10.txt', 'memo.txt'])

      // 键盘：↓ 选中第一行、Enter 进入，Backspace 回到上一级
      await grid(page).focus()
      await page.keyboard.press('ArrowDown')
      await expect(row(page, '設計書')).toHaveAttribute('aria-selected', 'true')
      await page.keyboard.press('Enter')
      await expect(tabs(page)).toHaveText(['設計書'])
      await expect(grid(page)).toBeFocused()
      await page.keyboard.press('Backspace')
      await expect(tabs(page)).toHaveText(['案件'])

      // 「上一级」可以越过条目根：面包屑一直显示到驱动器
      await panel(page).getByRole('button', { name: 'Up one level' }).click()
      await expect(tabs(page)).toHaveText([path.basename(files)])
      await expect(crumbs(page).getByRole('listitem').first()).toHaveText(
        path.parse(files).root.replace(/\\$/, '')
      )
      await row(page, '案件').dblclick()
      await expect(tabs(page)).toHaveText(['案件'])

      // 双击文件：在新的常驻标签中以 fallback 打开
      await row(page, 'memo.txt').dblclick()
      await expect(tabs(page)).toHaveText(['案件', 'memo.txt'])
      await expect(panel(page).getByRole('heading', { name: 'memo.txt' })).toBeVisible()
      await expect(page.getByRole('tablist').getByRole('tab', { name: 'memo.txt' })).toHaveCSS(
        'font-style',
        'normal'
      )
    } finally {
      await app.close()
    }
  })

  test('the directory shown in the active tab is focus: external changes appear without selecting it', async () => {
    // 只把关注点的间隔设为下限 2 秒；近 / 远层保持默认（30 秒 / 2 分钟，先比较目录修改时间）
    const { app, page } = await launch(userData)
    try {
      await data(page, 'settings.set', { 'cache.interval.focus.local': 2 })
      const tree = await setup(page)
      // 树中选中的是「案件」（关注点）；标签内导航到子目录「設計書」（只是关注点的子目录 = 近层）
      await tree.getByRole('treeitem', { name: '案件' }).click()
      await row(page, '設計書').dblclick()
      await expect(names(page)).toHaveText(['v1.txt'])
      await expect(tree.getByRole('treeitem', { name: '案件' })).toHaveAttribute(
        'aria-selected',
        'true'
      )

      // 文件内容变化不改变目录的修改时间：只有完整读取（关注点）才能发现大小的变化
      appendFileSync(path.join(project, '設計書', 'v1.txt'), 'x'.repeat(4096))
      await expect(row(page, 'v1.txt').getByRole('gridcell').last()).toHaveText('4 kB', {
        timeout: 10_000
      })
      writeFileSync(path.join(project, '設計書', 'new.txt'), 'new')
      await expect(names(page)).toHaveText(['new.txt', 'v1.txt'], { timeout: 10_000 })
    } finally {
      await app.close()
    }
  })

  test('a directory with 10,000 entries renders at most 100 rows', async () => {
    const big = path.join(project, 'big')
    mkdirSync(big)
    for (let i = 0; i < 10_000; i++) {
      writeFileSync(path.join(big, `f${String(i).padStart(5, '0')}.txt`), '')
    }
    const { app, page } = await launchFast(userData)
    try {
      const tree = await setup(page)
      await tree.getByRole('treeitem', { name: '案件' }).click()
      await tree.getByRole('treeitem', { name: 'big' }).dblclick()
      await expect(panel(page).getByRole('status').last()).toContainText('10,000 items', {
        timeout: 20_000
      })
      await expect(names(page).first()).toHaveText('f00000.txt')
      const count = await rows(page).count()
      expect(count).toBeGreaterThan(0)
      expect(count).toBeLessThanOrEqual(100)

      // 滚到末尾：最后一项可见，行数仍有上限
      await grid(page).focus()
      await page.keyboard.press('End')
      await expect(row(page, 'f09999.txt')).toBeVisible()
      await expect(row(page, 'f09999.txt')).toHaveAttribute('aria-selected', 'true')
      expect(await rows(page).count()).toBeLessThanOrEqual(100)
    } finally {
      await app.close()
    }
  })

  test('deleting the directory shown in a tab shows an error instead of crashing', async () => {
    const { app, page } = await launchFast(userData)
    try {
      const tree = await setup(page)
      await tree.getByRole('treeitem', { name: '案件' }).dblclick()
      await row(page, '設計書').dblclick()
      await expect(names(page)).toHaveText(['v1.txt'])

      rmSync(path.join(project, '設計書'), { recursive: true })
      await expect(panel(page).getByRole('alert')).toContainText('File or folder not found', {
        timeout: 10_000
      })
      // 标签与外壳不受影响
      await expect(tabs(page)).toHaveText(['設計書'])
      await expect(tree).toBeVisible()
    } finally {
      await app.close()
    }
  })
})
