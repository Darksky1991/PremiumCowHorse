import { appendFileSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import {
  data,
  hangStat,
  launch,
  launchFast,
  removeDirs,
  sendReachability,
  toggleRow
} from './support'

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
    // 文本插件之外的文件（开头含 NUL → sniff 为二进制 → 文件信息）
    writeFileSync(path.join(project, 'memo.dat'), Buffer.alloc(1536))
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

  test('lists names, modified times, types and sizes; headers sort with folders first', async () => {
    const { app, page } = await launchFast(userData)
    try {
      const tree = await setup(page)
      await tree.getByRole('treeitem', { name: '案件' }).dblclick()
      await expect(tabs(page)).toHaveText(['案件'])

      // 默认按名称升序（数字按数值），目录在前
      await expect(names(page)).toHaveText(['設計書', 'file2.txt', 'file10.txt', 'memo.dat'])
      const memo = row(page, 'memo.dat').getByRole('gridcell')
      const expectedTime = await page.evaluate(
        (ms) =>
          new Intl.DateTimeFormat('en', { dateStyle: 'short', timeStyle: 'short' }).format(ms),
        statSync(path.join(project, 'memo.dat')).mtimeMs
      )
      await expect(memo).toHaveText(['memo.dat', expectedTime, 'DAT file', '1.5 kB'])
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
      await expect(names(page)).toHaveText(['設計書', 'memo.dat', 'file10.txt', 'file2.txt'])
      const sizeHeader = grid(page).getByRole('columnheader', { name: 'Size' })
      await sizeHeader.getByRole('button').click()
      await expect(sizeHeader).toHaveAttribute('aria-sort', 'ascending')
      await expect(nameHeader).toHaveAttribute('aria-sort', 'none')
      await expect(names(page)).toHaveText(['設計書', 'file10.txt', 'file2.txt', 'memo.dat'])
    } finally {
      await app.close()
    }
  })

  test('double click navigates in the same tab; Backspace / Alt+Up go up to the entry root and then the workspace overview; files open in the current tab, middle / Ctrl+click in a new one', async () => {
    const { app, page } = await launchFast(userData)
    try {
      const tree = await setup(page)
      await tree.getByRole('treeitem', { name: '案件' }).dblclick()
      await expect(names(page)).toHaveText(['設計書', 'file2.txt', 'file10.txt', 'memo.dat'])
      // 面包屑、「上一级」与刷新按钮已移到应用的地址栏（M1-3b）：目录视图内没有
      await expect(panel(page).getByRole('navigation')).toHaveCount(0)
      await expect(panel(page).getByRole('button', { name: 'Up one level' })).toHaveCount(0)
      await expect(panel(page).getByRole('button', { name: 'Refresh' })).toHaveCount(0)

      await row(page, '設計書').dblclick()
      await expect(tabs(page)).toHaveText(['設計書'])
      await expect(names(page)).toHaveText(['v1.txt'])

      // 键盘：Backspace 回到上一级（条目根）；↓ 选中第一行、Enter 进入，Alt+↑ 回到上一级
      await grid(page).focus()
      await page.keyboard.press('Backspace')
      await expect(tabs(page)).toHaveText(['案件'])
      await expect(grid(page)).toBeFocused()
      await page.keyboard.press('ArrowDown')
      await expect(row(page, '設計書')).toHaveAttribute('aria-selected', 'true')
      await page.keyboard.press('Enter')
      await expect(tabs(page)).toHaveText(['設計書'])
      await expect(grid(page)).toBeFocused()
      await page.keyboard.press('Alt+ArrowUp')
      await expect(tabs(page)).toHaveText(['案件'])

      // 条目根的上一级是工作区总览（不越过条目根走到磁盘上的上级）；总览中 Backspace 不是命令
      // （总览的上一级是工作区一览，经地址栏的 ↑ / Alt+↑ 进入，见 address-bar.spec.ts）
      await expect(grid(page)).toBeFocused()
      await page.keyboard.press('Backspace')
      await expect(tabs(page)).toHaveText(['Default'])
      await expect(panel(page).getByRole('heading', { name: 'Default' })).toBeVisible()
      await expect(panel(page).getByRole('button', { name: '案件' })).toBeFocused()
      await page.keyboard.press('Backspace')
      await expect(tabs(page)).toHaveText(['Default'])
      await panel(page).getByRole('button', { name: '案件' }).dblclick()
      await expect(tabs(page)).toHaveText(['案件'])

      // 双击文件：在当前标签中以 fallback 打开（进入历史，后退回到列表；设计 2.8）
      await row(page, 'memo.dat').dblclick()
      await expect(tabs(page)).toHaveText(['memo.dat'])
      await expect(panel(page).getByRole('heading', { name: 'memo.dat' })).toBeVisible()
      await page.keyboard.press('Alt+ArrowLeft')
      await expect(tabs(page)).toHaveText(['案件'])
      await expect(names(page)).toHaveText(['設計書', 'file2.txt', 'file10.txt', 'memo.dat'])

      // 中键 / Ctrl+单击 / Ctrl+Enter：在新标签打开（同 URI 已打开则只激活）
      const tab = (name: string): Locator =>
        page.getByRole('tablist').getByRole('tab', { name, exact: true })
      await row(page, 'memo.dat').click({ button: 'middle' })
      await expect(tabs(page)).toHaveText(['案件', 'memo.dat'])
      await tab('案件').click()
      await row(page, '設計書').click({ modifiers: ['Control'] })
      await expect(tabs(page)).toHaveText(['案件', '設計書', 'memo.dat'])
      await tab('案件').click()
      await grid(page).focus()
      await page.keyboard.press('End')
      await page.keyboard.press('Control+Enter')
      await expect(tabs(page)).toHaveText(['案件', '設計書', 'memo.dat'])
      await expect(tab('memo.dat')).toHaveAttribute('aria-selected', 'true')
    } finally {
      await app.close()
    }
  })

  test('back from a file restores the listing state: sort order, selection and scroll position', async () => {
    const many = path.join(project, 'many')
    mkdirSync(many)
    for (let i = 0; i < 300; i++) {
      writeFileSync(path.join(many, `f${String(i).padStart(5, '0')}.txt`), '')
    }
    const { app, page } = await launchFast(userData)
    try {
      const tree = await setup(page)
      await tree.getByRole('treeitem', { name: '案件' }).dblclick()
      await row(page, 'many').dblclick()
      await expect(tabs(page)).toHaveText(['many'])
      await expect(names(page).first()).toHaveText('f00000.txt')

      // 名称降序、End 选中末行（f00000.txt）并滚到底部
      const nameHeader = grid(page).getByRole('columnheader', { name: 'Name' })
      await nameHeader.getByRole('button').click()
      await expect(nameHeader).toHaveAttribute('aria-sort', 'descending')
      await grid(page).focus()
      await page.keyboard.press('End')
      await expect(row(page, 'f00000.txt')).toHaveAttribute('aria-selected', 'true')
      const scroller = grid(page).locator('[role="rowgroup"]').nth(1)
      await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBeGreaterThan(1000)
      // 滚动位置防抖保存（150ms）
      await page.waitForTimeout(500)
      const scrollTop = await scroller.evaluate((el) => el.scrollTop)

      // 打开文件后后退：排序、选中、滚动位置都恢复（设计 2.8「后退回到目录列表」）
      await page.keyboard.press('Enter')
      await expect(tabs(page)).toHaveText(['f00000.txt'])
      await page.keyboard.press('Alt+ArrowLeft')
      await expect(tabs(page)).toHaveText(['many'])
      await expect(nameHeader).toHaveAttribute('aria-sort', 'descending')
      await expect(row(page, 'f00000.txt')).toHaveAttribute('aria-selected', 'true')
      await expect(row(page, 'f00000.txt')).toBeInViewport()
      await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBeCloseTo(scrollTop, -1)
    } finally {
      await app.close()
    }
  })

  test('the workspace overview lists entries with their aliases by group; double click enters a folder or opens a file in the current tab', async () => {
    const { app, page } = await launchFast(userData)
    try {
      await data(page, 'settings.set', { 'general.language': 'en' })
      await expect(page.locator('html')).toHaveAttribute('lang', 'en')
      const { id: workspaceId } = await data(page, 'workspace.active')
      await data(page, 'entry.add', {
        kind: 'folder',
        workspaceId,
        parentId: null,
        path: project,
        label: '本番'
      })
      const group = await data(page, 'entry.add', {
        kind: 'group',
        workspaceId,
        parentId: null,
        label: 'Docs'
      })
      await data(page, 'entry.add', {
        kind: 'file',
        workspaceId,
        parentId: group.id,
        path: path.join(project, 'memo.dat'),
        label: 'メモ'
      })
      const tree = page.getByRole('tree')
      await tree.getByRole('treeitem', { name: '本番' }).dblclick()
      await row(page, '設計書').dblclick()
      await expect(tabs(page)).toHaveText(['設計書'])

      // 回到条目根：标签标题为别名；再上一级是工作区总览
      await grid(page).focus()
      await page.keyboard.press('Backspace')
      await expect(tabs(page)).toHaveText(['本番'])
      await page.keyboard.press('Backspace')
      await expect(tabs(page)).toHaveText(['Default'])

      // 未分组的项在前，分组为分节；项为别名，悬停提示为真实路径
      const ungrouped = panel(page).getByRole('list').first()
      await expect(ungrouped.getByRole('button')).toHaveCount(1)
      await expect(ungrouped.getByRole('button', { name: '本番' })).toHaveAttribute(
        'title',
        project
      )
      const docs = panel(page).getByRole('region', { name: 'Docs' })
      await expect(docs.getByRole('button', { name: 'メモ' })).toHaveAttribute(
        'title',
        path.join(project, 'memo.dat')
      )

      // 双击 file 条目：在当前标签打开（后退回到总览）；中键在新标签打开（总览标签不变）
      await docs.getByRole('button', { name: 'メモ' }).dblclick()
      await expect(tabs(page)).toHaveText(['メモ'])
      await expect(panel(page).getByRole('heading', { name: 'memo.dat' })).toBeVisible()
      await page.keyboard.press('Alt+ArrowLeft')
      await expect(tabs(page)).toHaveText(['Default'])
      await docs.getByRole('button', { name: 'メモ' }).click({ button: 'middle' })
      await expect(tabs(page)).toHaveText(['Default', 'メモ'])

      // 双击 folder 条目：在当前标签内进入（Enter 相同）
      await page.getByRole('tablist').getByRole('tab', { name: 'Default' }).click()
      await panel(page).getByRole('button', { name: '本番' }).dblclick()
      await expect(tabs(page)).toHaveText(['本番', 'メモ'])
      await expect(names(page)).toHaveText(['設計書', 'file2.txt', 'file10.txt', 'memo.dat'])
      await grid(page).focus()
      await page.keyboard.press('Backspace')
      await expect(tabs(page)).toHaveText(['Default', 'メモ'])
      await panel(page).getByRole('button', { name: '本番' }).focus()
      await page.keyboard.press('Enter')
      await expect(tabs(page)).toHaveText(['本番', 'メモ'])
    } finally {
      await app.close()
    }
  })

  test('the directory shown in the active tab is focus: external changes appear without selecting it', async () => {
    // 只把关注点的间隔设为下限 2 秒；近 / 远层保持默认（30 秒 / 2 分钟，先比较目录修改时间）
    const { app, page } = await launch(userData)
    try {
      // 单击只选中（不打开）：这样标签显示的目录才能与树的选中不同（标签变化时树会跟随选中）
      await data(page, 'settings.set', {
        'cache.interval.focus.local': 2,
        'explorer.singleClickPreview': false
      })
      const tree = await setup(page)
      // 标签显示子目录「設計書」，树中选中的是「案件」（关注点）：「設計書」只是关注点的子目录 = 近层
      await toggleRow(tree.getByRole('treeitem', { name: '案件' }))
      await tree.getByRole('treeitem', { name: '設計書' }).click()
      await page.keyboard.press('Enter')
      await expect(names(page)).toHaveText(['v1.txt'])
      await tree.getByRole('treeitem', { name: '案件' }).click()
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
      await toggleRow(tree.getByRole('treeitem', { name: '案件' }))
      await tree.getByRole('treeitem', { name: 'big' }).click()
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

  test('a disconnected share: directory tabs show their listing and "disconnected" at once; file tabs do not stat', async () => {
    const { app, page } = await launchFast(userData)
    try {
      const tree = await setup(page)
      // 双击：在标签中打开并展开
      await tree.getByRole('treeitem', { name: '案件' }).dblclick()
      await expect(names(page)).toHaveText(['設計書', 'file2.txt', 'file10.txt', 'memo.dat'])
      const status = panel(page).getByRole('status').last()
      await expect(status).not.toContainText('Disconnected')

      // 无响应的共享：stat 一直不返回；渲染端收到「断开」
      const stat = await hangStat(app)
      const share = `${path.parse(project).root[0]!.toUpperCase()}:`
      await sendReachability(app, share, 'offline')
      // 显示中的目录视图随之显示「已断开」，列表保留
      await expect(status).toContainText('Disconnected')
      await expect(names(page)).toHaveText(['設計書', 'file2.txt', 'file10.txt', 'memo.dat'])

      // 文件标签：不发 stat，只显示文件名与「已断开」
      await tree.getByRole('treeitem', { name: 'memo.dat' }).click()
      await expect(tabs(page)).toHaveText(['memo.dat'])
      await expect(panel(page).getByRole('heading', { name: 'memo.dat' })).toBeVisible()
      await expect(panel(page).getByRole('status')).toContainText('disconnected')
      expect(await stat.calls()).toBe(0)

      // 目录标签：不等 stat，立即显示列表与「已断开」（stat 卡住时此前要等到超时）
      await tree.getByRole('treeitem', { name: '設計書' }).click()
      await expect(tabs(page)).toHaveText(['設計書'])
      await expect(names(page)).toHaveText(['v1.txt'], { timeout: 3000 })
      await expect(panel(page).getByRole('status').last()).toContainText('Disconnected')
      expect(await stat.calls()).toBe(0)

      // 恢复在线：「已断开」消失；文件标签照常 stat 后显示文件信息
      await stat.restore()
      await sendReachability(app, share, 'online')
      await expect(panel(page).getByRole('status').last()).not.toContainText('Disconnected')
      await tree.getByRole('treeitem', { name: 'memo.dat' }).click()
      await expect(panel(page).getByRole('heading', { name: 'memo.dat' })).toBeVisible()
      await expect(panel(page).getByText('1.5 kB', { exact: false }).first()).toBeVisible()
    } finally {
      await app.close()
    }
  })

  test('the address bar refresh button and F5 re-list the directory and re-stat a file at once (without waiting for the periodic check)', async () => {
    // 定期确认的间隔设为 1 小时（在添加条目之前）：列表在用例期间不会自己更新，只能靠刷新
    const { app, page } = await launch(userData)
    try {
      await data(page, 'settings.set', {
        'cache.interval.focus.local': 3600,
        'cache.interval.near.local': 3600,
        'cache.interval.far.local': 3600
      })
      const tree = await setup(page)
      await tree.getByRole('treeitem', { name: '案件' }).dblclick()
      await expect(names(page)).toHaveText(['設計書', 'file2.txt', 'file10.txt', 'memo.dat'])

      // 刷新按钮在应用的地址栏（M1-3b）
      const addressBar = page.getByRole('navigation', { name: 'Address bar' })
      writeFileSync(path.join(project, 'added.txt'), 'a')
      await addressBar.getByRole('button', { name: 'Refresh', exact: true }).click()
      await expect(names(page)).toHaveText([
        '設計書',
        'added.txt',
        'file2.txt',
        'file10.txt',
        'memo.dat'
      ])

      // F5（全局）：焦点在目录视图时
      mkdirSync(path.join(project, 'new-folder'))
      await grid(page).focus()
      await page.keyboard.press('F5')
      await expect(names(page)).toHaveText([
        'new-folder',
        '設計書',
        'added.txt',
        'file2.txt',
        'file10.txt',
        'memo.dat'
      ])
      await expect(grid(page)).toBeFocused()

      // 文件标签：F5 重新 stat（不等 5 秒的新鲜期），文件信息随之更新；焦点在地址栏的按钮上也有效
      await row(page, 'memo.dat').dblclick()
      await expect(panel(page).getByText('1,536 bytes', { exact: false })).toBeVisible()
      appendFileSync(path.join(project, 'memo.dat'), 'x'.repeat(2560))
      await addressBar.getByRole('button', { name: 'Refresh', exact: true }).focus()
      await page.keyboard.press('F5')
      await expect(panel(page).getByText('4,096 bytes', { exact: false })).toBeVisible()
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
