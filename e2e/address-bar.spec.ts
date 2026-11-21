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
      // 当前位置为最后一段；悬停提示为真实路径（当前段附「单击复制」，工作区段没有）
      await expect(segment(page, '設計書')).toHaveAttribute('aria-current', 'location')
      await expect(segment(page, '設計書')).toHaveAttribute(
        'title',
        `${path.join(project, '設計書')}\nClick to copy the path`
      )
      await expect(segment(page, '案件')).toHaveAttribute('title', project)
      await expect(segment(page, 'Default')).toHaveAttribute('title', '')
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

      // 上一级：条目内逐级向上，条目根之上是工作区总览，总览之上是工作区一览；一览没有上一级
      await expect(button(page, 'Up one level')).toHaveAttribute('title', 'Up one level (Alt+↑)')
      await button(page, 'Up one level').click()
      await expect(tabs(page)).toHaveText(['案件'])
      await button(page, 'Up one level').click()
      await expect(tabs(page)).toHaveText(['Default'])
      await expect(segments(page)).toHaveText(['Default'])
      await button(page, 'Up one level').click()
      await expect(tabs(page)).toHaveText(['Workspaces'])
      await expect(segments(page)).toHaveText(['Workspaces'])
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
        `${path.join(project, '設計書', 'v1.txt')}\nClick to copy the path`
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

  test('clicking the current segment or the empty space after it copies the path; Ctrl+click still opens a new tab', async () => {
    const { app, page } = await launchFast(userData)
    try {
      const { tree } = await setup(page)
      const clipboard = (): Promise<string> => app.evaluate(({ clipboard }) => clipboard.readText())
      const box = bar(page).locator('[data-slot="address-box"]')
      await app.evaluate(({ clipboard }) => clipboard.writeText('before'))

      // 工作区总览：没有路径，单击当前段 / 空白处不复制，也不导航
      await segment(page, 'Default').click()
      await expect(tabs(page)).toHaveText(['Default'])
      await segment(page, 'Default').click()
      await box.click({ position: { x: (await box.boundingBox())!.width - 10, y: 10 } })
      expect(await clipboard()).toBe('before')
      await expect(tabs(page)).toHaveText(['Default'])

      // 目录：单击当前段复制 Windows 路径（提示），历史不变
      await tree.getByRole('treeitem', { name: '案件' }).dblclick()
      await row(page, '設計書').dblclick()
      await expect(segments(page)).toHaveText(['Default', '案件', '設計書'])
      await segment(page, '設計書').click()
      await expect.poll(clipboard).toBe(path.join(project, '設計書'))
      await expect(page.getByText('Path copied')).toBeVisible()
      await expect(tabs(page)).toHaveText(['設計書'])
      await expect(button(page, 'Forward')).toBeDisabled()

      // 段后面的空白处：同样复制
      await app.evaluate(({ clipboard }) => clipboard.writeText('before'))
      await box.click({ position: { x: (await box.boundingBox())!.width - 10, y: 10 } })
      await expect.poll(clipboard).toBe(path.join(project, '設計書'))

      // Ctrl+单击当前段：按「在新标签打开」处理（同 URI 已打开 → 只激活），不复制
      await app.evaluate(({ clipboard }) => clipboard.writeText('before'))
      await segment(page, '設計書').click({ modifiers: ['Control'] })
      await expect(tabs(page)).toHaveText(['設計書'])
      expect(await clipboard()).toBe('before')
      // 文件：复制文件的完整路径
      await row(page, 'v1.txt').dblclick()
      await expect(tabs(page)).toHaveText(['v1.txt'])
      await segment(page, 'v1.txt').click()
      await expect.poll(clipboard).toBe(path.join(project, '設計書', 'v1.txt'))
    } finally {
      await app.close()
    }
  })

  test('the workspace part (button + workspace segment) is a separate block at the start of the address box', async () => {
    const { app, page } = await launchFast(userData)
    try {
      const { tree } = await setup(page)
      await tree.getByRole('treeitem', { name: '案件' }).dblclick()
      await expect(segments(page)).toHaveText(['Default', '案件'])
      const part = bar(page).locator('[data-slot="address-workspace"]')
      await expect(part.getByRole('button')).toHaveCount(2)
      await expect(
        part.getByRole('button', { name: 'Switch workspace', exact: true })
      ).toBeVisible()
      await expect(part).toHaveText('Default')
      // 底色与地址框不同（区分工作区与路径）
      const background = (l: Locator): Promise<string> =>
        l.evaluate((el) => getComputedStyle(el).backgroundColor)
      expect(await background(part)).not.toBe(
        await background(bar(page).locator('[data-slot="address-box"]'))
      )
    } finally {
      await app.close()
    }
  })

  test('the workspace button sits in front of the path inside the address box; its menu switches workspaces and "Manage workspaces…" opens the list page', async () => {
    const { app, page } = await launchFast(userData)
    try {
      await setup(page)
      await data(page, 'workspace.create', { name: '別件' })
      const layers = button(page, 'Switch workspace')
      // 地址框中：工作区按钮（GalleryVertical）在工作区名前面，没有向下箭头
      const box = bar(page).locator('[data-slot="address-box"]')
      await expect(box.getByRole('button', { name: 'Switch workspace', exact: true })).toBeVisible()
      await expect(box.getByRole('listitem')).toHaveText(['Default'])
      const layersBox = (await layers.boundingBox())!
      const firstSegment = (await segment(page, 'Default').boundingBox())!
      expect(layersBox.x + layersBox.width).toBeLessThanOrEqual(firstSegment.x)
      await expect(layers.locator('svg')).toHaveClass(/lucide-gallery-vertical/)
      await expect(bar(page).locator('svg.lucide-chevron-down')).toHaveCount(0)
      // 导航按钮与查看器按钮在框外
      await expect(box.getByRole('button', { name: 'Back', exact: true })).toHaveCount(0)
      await expect(box.getByRole('button', { name: 'View as', exact: true })).toHaveCount(0)

      // 菜单列出工作区，底部「Manage workspaces…」：没有标签时新建标签显示工作区一览
      await layers.click()
      await expect(page.getByRole('menuitemradio')).toHaveText(['Default', '別件'])
      await page.getByRole('menuitem', { name: 'Manage workspaces…' }).click()
      await expect(tabs(page)).toHaveText(['Workspaces'])
      await expect(segments(page)).toHaveText(['Workspaces'])
      const list = panel(page).getByRole('list', { name: 'Workspaces' })
      await expect(list.locator('[data-workspace-id]')).toHaveCount(2)
      await expect(list.locator('[data-workspace-id][aria-current="true"]')).toContainText(
        'Default'
      )

      // 有激活标签时在当前标签导航到一览（进入历史）
      await layers.click()
      await page.getByRole('menuitemradio', { name: '別件' }).click()
      await expect(
        page.getByRole('banner').getByRole('button', { name: 'Switch workspace' })
      ).toHaveText('別件')
      await segment(page, '別件').click()
      await expect(tabs(page)).toHaveText(['別件'])
      await layers.click()
      await page.getByRole('menuitem', { name: 'Manage workspaces…' }).click()
      await expect(tabs(page)).toHaveText(['Workspaces'])
      await expect(button(page, 'Back')).toBeEnabled()
    } finally {
      await app.close()
    }
  })

  test('↑ and Alt+↑ from the overview open the list page; double-clicking another workspace switches, and the old tab no longer stays on the list page', async () => {
    const { app, page } = await launchFast(userData)
    try {
      await setup(page)
      await data(page, 'workspace.create', { name: '別件' })
      const banner = page.getByRole('banner').getByRole('button', { name: 'Switch workspace' })
      const item = (name: string): Locator =>
        panel(page).locator('[data-workspace-id]').filter({ hasText: name })

      // 总览：↑ 进入一览，后退回到总览，Alt+↑ 再进入一览
      await segment(page, 'Default').click()
      await expect(tabs(page)).toHaveText(['Default'])
      await button(page, 'Up one level').click()
      await expect(tabs(page)).toHaveText(['Workspaces'])
      await button(page, 'Back').click()
      await expect(tabs(page)).toHaveText(['Default'])
      await panel(page).getByRole('button', { name: '案件' }).focus()
      await page.keyboard.press('Alt+ArrowUp')
      await expect(tabs(page)).toHaveText(['Workspaces'])
      await expect(segments(page)).toHaveText(['Workspaces'])
      // 焦点随旧视图一起移除后：落在刚离开的工作区（从总览上来）
      await expect(item('Default')).toBeFocused()

      // 键盘（卡片网格，同一行）：→ 移到下一张，最后是「新建」卡片；← 返回；当前工作区 Enter = 进入其总览（下一级）
      await page.keyboard.press('ArrowRight')
      await expect(item('別件')).toBeFocused()
      await page.keyboard.press('ArrowRight')
      await expect(panel(page).getByRole('button', { name: 'New workspace…' })).toBeFocused()
      await page.keyboard.press('Home')
      await expect(item('Default')).toBeFocused()
      await page.keyboard.press('Enter')
      await expect(tabs(page)).toHaveText(['Default'])
      await button(page, 'Back').click()
      await expect(tabs(page)).toHaveText(['Workspaces'])

      // 双击另一个工作区：切换过去（该工作区还没有标签）
      await item('別件').dblclick()
      await expect(banner).toHaveText('別件')
      await expect(page.getByRole('tablist')).toHaveCount(0)
      await expect(segments(page)).toHaveText(['別件'])

      // 切回：原标签已后退一步（总览），不停在一览页
      await button(page, 'Switch workspace').click()
      await page.getByRole('menuitemradio', { name: 'Default' }).click()
      await expect(banner).toHaveText('Default')
      await expect(tabs(page)).toHaveText(['Default'])
      await expect(segments(page)).toHaveText(['Default'])
      await expect(button(page, 'Forward')).toBeEnabled()
    } finally {
      await app.close()
    }
  })

  /**
   * 开始记录地址栏与标签栏中出现过的文字（含只存在一次提交、随即被替换的中间状态）：
   * MutationObserver 收集新增节点的文字与文字变化。返回读取记录的函数
   */
  async function recordShown(page: Page): Promise<() => Promise<string[]>> {
    await page.evaluate(() => {
      const w = window as unknown as {
        __pchShown?: string[]
        __pchShownObserver?: MutationObserver
      }
      w.__pchShownObserver?.disconnect()
      const shown: string[] = []
      w.__pchShown = shown
      const inScope = (n: Node): boolean =>
        (n instanceof Element ? n : n.parentElement)?.closest(
          'nav[aria-label="Address bar"], [role="tablist"]'
        ) != null
      w.__pchShownObserver = new MutationObserver((records) => {
        for (const r of records) {
          if (!inScope(r.target)) continue
          if (r.type === 'characterData') shown.push(r.target.textContent ?? '')
          r.addedNodes.forEach((n) => shown.push(n.textContent ?? ''))
        }
      })
      w.__pchShownObserver.observe(document.body, {
        subtree: true,
        childList: true,
        characterData: true
      })
    })
    return () =>
      page.evaluate(() => (window as unknown as { __pchShown: string[] }).__pchShown.slice())
  }

  test('switching away from the list page (double-click, Layers menu, title bar) steps the old tab back only after the new workspace is shown; other tabs keep their place', async () => {
    const { app, page } = await launchFast(userData)
    try {
      const { tree } = await setup(page)
      await data(page, 'workspace.create', { name: '別件' })
      const banner = page.getByRole('banner').getByRole('button', { name: 'Switch workspace' })
      const item = (name: string): Locator =>
        panel(page).locator('[data-workspace-id]').filter({ hasText: name })
      const switchWith = async (via: 'layers' | 'banner', name: string): Promise<void> => {
        await (via === 'layers' ? button(page, 'Switch workspace') : banner).click()
        await page.getByRole('menuitemradio', { name }).click()
        await expect(banner).toHaveText(name)
      }
      // 总览 → 一览（一览标签有后退历史：总览「Default」）
      await segment(page, 'Default').click()
      await expect(tabs(page)).toHaveText(['Default'])
      await button(page, 'Up one level').click()
      await expect(tabs(page)).toHaveText(['Workspaces'])

      // 一览中双击：切换期间旧标签不在界面上退回总览（地址栏 / 标签栏从未出现「Default」）
      let shown = await recordShown(page)
      await item('別件').dblclick()
      await expect(banner).toHaveText('別件')
      await expect(segments(page)).toHaveText(['別件'])
      expect((await shown()).filter((text) => text.includes('Default'))).toEqual([])
      await switchWith('layers', 'Default')
      await expect(tabs(page)).toHaveText(['Default'])

      // 地址框的 Layers 菜单从一览切走：同样后退，且不闪
      await button(page, 'Up one level').click()
      await expect(tabs(page)).toHaveText(['Workspaces'])
      shown = await recordShown(page)
      await switchWith('layers', '別件')
      await expect(segments(page)).toHaveText(['別件'])
      expect((await shown()).filter((text) => text.includes('Default'))).toEqual([])
      await switchWith('banner', 'Default')
      await expect(tabs(page)).toHaveText(['Default'])
      await expect(button(page, 'Forward')).toBeEnabled()

      // 标题栏的切换器从一览切走：同样后退
      await button(page, 'Up one level').click()
      await expect(tabs(page)).toHaveText(['Workspaces'])
      await switchWith('banner', '別件')
      await switchWith('layers', 'Default')
      await expect(tabs(page)).toHaveText(['Default'])

      // 一览标签不是激活标签时（激活的是另一个标签）：切走再切回，两个标签都不动
      await button(page, 'Up one level').click()
      await expect(tabs(page)).toHaveText(['Workspaces'])
      await tree.getByRole('treeitem', { name: '案件' }).click({ modifiers: ['Control'] })
      await expect(tabs(page)).toHaveText(['Workspaces', '案件'])
      await switchWith('layers', '別件')
      await switchWith('layers', 'Default')
      await expect(tabs(page)).toHaveText(['Workspaces', '案件'])
      await expect(page.getByRole('tab', { selected: true })).toHaveText('案件')
    } finally {
      await app.close()
    }
  })

  test('deleting the current workspace from the list page lands in the default workspace and removes it from the list', async () => {
    const { app, page } = await launchFast(userData)
    try {
      await setup(page)
      const other = await data(page, 'workspace.create', { name: '別件' })
      const banner = page.getByRole('banner').getByRole('button', { name: 'Switch workspace' })
      await data(page, 'workspace.activate', { id: other.id })
      await expect(banner).toHaveText('別件')
      await button(page, 'Switch workspace').click()
      await page.getByRole('menuitem', { name: 'Manage workspaces…' }).click()
      await expect(tabs(page)).toHaveText(['Workspaces'])
      const item = (name: string): Locator =>
        panel(page).locator('[data-workspace-id]').filter({ hasText: name })
      await expect(item('別件')).toHaveAttribute('aria-current', 'true')

      // 当前工作区的右键菜单「Delete…」：先切到默认工作区，再删除
      await item('別件').click({ button: 'right' })
      await page.getByRole('menuitem', { name: 'Delete…' }).click()
      await page
        .getByRole('alertdialog')
        .getByRole('button', { name: 'Delete', exact: true })
        .click()
      await expect(banner).toHaveText('Default')
      await expect(page.getByRole('alertdialog')).toHaveCount(0)
      await expect
        .poll(async () =>
          (await data<Array<{ id: string }>>(page, 'workspace.list')).map((w) => w.id)
        )
        .toEqual(['default'])
      await button(page, 'Switch workspace').click()
      await expect(page.getByRole('menuitemradio')).toHaveText(['Default'])
      await page.getByRole('menuitem', { name: 'Manage workspaces…' }).click()
      await expect(panel(page).locator('[data-workspace-id]')).toHaveCount(1)
      await expect(item('Default')).toHaveAttribute('aria-current', 'true')
    } finally {
      await app.close()
    }
  })

  test('the list page creates, renames and deletes workspaces', async () => {
    const { app, page } = await launchFast(userData)
    try {
      await setup(page)
      const banner = page.getByRole('banner').getByRole('button', { name: 'Switch workspace' })
      const item = (name: string): Locator =>
        panel(page).locator('[data-workspace-id]').filter({ hasText: name })
      await button(page, 'Switch workspace').click()
      await page.getByRole('menuitem', { name: 'Manage workspaces…' }).click()
      await expect(tabs(page)).toHaveText(['Workspaces'])

      // 新建：创建后切换过去；一览标签没有后退历史，切回时仍在一览
      await panel(page).getByRole('button', { name: 'New workspace…' }).click()
      const dialog = page.getByRole('dialog')
      await dialog.getByRole('textbox').fill('第三')
      await dialog.getByRole('button', { name: 'Create' }).click()
      await expect(banner).toHaveText('第三')
      await button(page, 'Switch workspace').click()
      await page.getByRole('menuitemradio', { name: 'Default' }).click()
      await expect(banner).toHaveText('Default')
      await expect(tabs(page)).toHaveText(['Workspaces'])
      await expect(item('第三')).toBeVisible()

      // 卡片：不显示图标；操作直接以按钮显示（默认工作区没有「删除」按钮）
      const card = (name: string): Locator =>
        panel(page).locator('[data-workspace-row]').filter({ hasText: name })
      await expect(item('第三').locator('svg')).toHaveCount(0)
      await expect(card('第三').getByRole('button', { name: 'Delete…' })).toBeVisible()
      await expect(card('Default').getByRole('button', { name: 'Rename…' })).toBeVisible()
      await expect(card('Default').getByRole('button', { name: 'Delete…' })).toHaveCount(0)

      // 各行等高：窗口变窄、新建卡片与工作区卡片不在同一行时高度一致
      const heights = async (): Promise<number[]> =>
        panel(page)
          .locator('[data-workspace-nav]')
          .evaluateAll((els) =>
            els.map((el) => Math.round(el.closest('li')!.getBoundingClientRect().height))
          )
      const tops = async (): Promise<number[]> =>
        panel(page)
          .locator('[data-workspace-nav]')
          .evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().top)))
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(900, 700))
      await expect.poll(async () => new Set(await tops()).size).toBeGreaterThan(1)
      expect(new Set(await heights()).size).toBe(1)

      // 重命名（卡片上的按钮）
      await card('第三').getByRole('button', { name: 'Rename…' }).click()
      await expect(dialog.getByRole('textbox')).toHaveValue('第三')
      await dialog.getByRole('textbox').fill('第四')
      await dialog.getByRole('button', { name: 'Save' }).click()
      await expect(dialog).toHaveCount(0)
      await expect(item('第四')).toBeVisible()
      await expect(item('第三')).toHaveCount(0)

      // 删除（右键菜单）：删除的不是当前工作区，不切换
      await item('第四').click({ button: 'right' })
      await page.getByRole('menuitem', { name: 'Delete…' }).click()
      const confirm = page.getByRole('alertdialog')
      await confirm.getByRole('button', { name: 'Delete', exact: true }).click()
      await expect(confirm).toHaveCount(0)
      await expect(item('第四')).toHaveCount(0)
      await expect(panel(page).locator('[data-workspace-id]')).toHaveCount(1)
      await expect(banner).toHaveText('Default')
      await expect(tabs(page)).toHaveText(['Workspaces'])
      // 默认工作区没有「删除」
      await item('Default').click({ button: 'right' })
      await expect(page.getByRole('menuitem', { name: 'Rename…' })).toBeVisible()
      await expect(page.getByRole('menuitem', { name: 'Delete…' })).toHaveCount(0)
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

  test('the viewer menu switches the viewer of a location (restored by back / forward); "always open" makes it the default for the extension', async () => {
    writeFileSync(path.join(project, 'second.txt'), 'second')
    const { app, page } = await launchFast(userData)
    try {
      const { tree } = await setup(page)
      const viewerButton = button(page, 'View as')
      const textView = panel(page).getByRole('region', { name: 'File content' })
      const infoView = panel(page).getByRole('button', { name: 'Copy path' })

      // 目录：候选为文件夹 + 文件信息
      await tree.getByRole('treeitem', { name: '案件' }).dblclick()
      await expect(viewerButton).toBeEnabled()
      await row(page, 'memo.txt').dblclick()
      await expect(textView).toBeVisible()

      // 切到「File info」：内容为 fallback，菜单中该项选中
      await viewerButton.click()
      await page.getByRole('menuitemradio', { name: 'File info' }).click()
      await expect(infoView).toBeVisible()
      await expect(textView).toHaveCount(0)
      await viewerButton.click()
      await expect(page.getByRole('menuitemradio', { name: 'File info' })).toBeChecked()
      await page.keyboard.press('Escape')

      // 后退再前进恢复所选（查看器随位置进入历史）；后退到目录后按钮仍可用
      await button(page, 'Back').click()
      await expect(row(page, 'memo.txt')).toBeVisible()
      await button(page, 'Forward').click()
      await expect(infoView).toBeVisible()

      // 勾选「总是用这个打开」：同扩展名的文件在新标签中直接用所选
      await viewerButton.click()
      await page.getByRole('menuitemcheckbox', { name: 'Always open .txt with this' }).click()
      await expect
        .poll(
          async () =>
            (await data<Record<string, string>>(page, 'settings.getAll'))['preview.associations']
        )
        .toEqual({ txt: 'pch.preview.fallback' })
      // 勾选项点击后菜单保持打开
      await page.keyboard.press('Escape')
      await button(page, 'Back').click()
      await row(page, 'second.txt').click({ modifiers: ['Control'] })
      await expect(tabs(page)).toHaveCount(2)
      await expect(infoView).toBeVisible()
      await expect(textView).toHaveCount(0)

      // 取消勾选：删除关联
      await viewerButton.click()
      const always = page.getByRole('menuitemcheckbox', { name: 'Always open .txt with this' })
      await expect(always).toBeChecked()
      await always.click()
      await expect
        .poll(
          async () =>
            (await data<Record<string, string>>(page, 'settings.getAll'))['preview.associations']
        )
        .toEqual({})
    } finally {
      await app.close()
    }
  })
})
