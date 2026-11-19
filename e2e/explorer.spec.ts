import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { expect, test, type Page } from '@playwright/test'
import { data, launchFast, type Named, removeDirs, snapshotTree, toggleRow } from './support'

/** 「找不到」错误行的文案（errors:FS_NOT_FOUND，ja | zh-CN | en） */
const notFoundLabel =
  /(ファイルまたはフォルダーが見つかりません|找不到文件或文件夹|File or folder not found)/
const retryButton = /^(再試行|重试|Retry)$/

type Entry = Named & { kind: string; parentId: string | null }
type Listing = { items: Named[]; state: 'fresh' | 'cached' | 'offline'; checkedAt: number | null }

/** 落点：行的上缘（before）、中间（分组为 inside）、下缘（after）；null 为树的空白处 */
type DropAt = { row: string; at: 'top' | 'middle' | 'bottom' } | null

/**
 * 在页面内合成一次原生拖放：dragstart（来源行）→ dragover / drop（落点）→ dragend。
 * Playwright 无法产生系统级拖放，这里与 React 的 onDragStart / onDragOver / onDrop 走同一路径。
 * 返回 dataTransfer 的类型与 dragover 是否被 preventDefault（未被阻止 = 不接受放置、不会触发 drop）。
 */
async function dragRow(
  page: Page,
  source: string,
  target: DropAt
): Promise<{ types: string[]; accepted: boolean }> {
  return page.evaluate(
    ([sourceLabel, drop]) => {
      const rows = [...document.querySelectorAll<HTMLElement>('[role="treeitem"]')]
      const find = (label: string): HTMLElement => {
        const row = rows.find((r) => r.textContent === label)
        if (!row) throw new Error(`row not found: ${label}`)
        return row
      }
      const tree = document.querySelector<HTMLElement>('[role="tree"]')!
      const dt = new DataTransfer()
      const fire = (el: HTMLElement, type: string, clientY: number): DragEvent => {
        const ev = new DragEvent(type, {
          bubbles: true,
          cancelable: true,
          dataTransfer: dt,
          clientX: el.getBoundingClientRect().left + 10,
          clientY
        })
        el.dispatchEvent(ev)
        return ev
      }
      const from = find(sourceLabel)
      fire(from, 'dragstart', from.getBoundingClientRect().top + 5)
      let el: HTMLElement
      let y: number
      if (drop === null) {
        // 空白处：最后一行下方
        el = tree
        y = rows.at(-1)!.getBoundingClientRect().bottom + 40
      } else {
        el = find(drop.row)
        const rect = el.getBoundingClientRect()
        y =
          drop.at === 'top'
            ? rect.top + 2
            : drop.at === 'bottom'
              ? rect.bottom - 2
              : rect.top + rect.height / 2
      }
      const over = fire(el, 'dragover', y)
      if (over.defaultPrevented) fire(el, 'drop', y)
      fire(from, 'dragend', 0)
      return { types: [...dt.types], accepted: over.defaultPrevented }
    },
    [source, target] as const
  )
}

test.describe('explorer tree on real directories', () => {
  let userData: string
  let files: string
  let project: string

  test.beforeEach(() => {
    userData = mkdtempSync(path.join(tmpdir(), 'pch-e2e-'))
    files = mkdtempSync(path.join(tmpdir(), 'pch-e2e-files-'))
    project = path.join(files, '案件')
    mkdirSync(path.join(project, '設計書'), { recursive: true })
    mkdirSync(path.join(project, '議事録'))
    writeFileSync(path.join(project, '設計書', '仕様.xlsx'), 'spec')
    writeFileSync(path.join(project, '議事録', '20261118.docx'), 'minutes')
    writeFileSync(path.join(project, 'README.md'), '# 案件')
  })
  test.afterEach(() => {
    removeDirs(userData, files)
  })

  test('principle: renaming an ancestor of an expanded directory succeeds', async () => {
    // 根本原则：应用不得影响文件系统。M1-2 的 fs.watch 监听 A\B\C 时，A 无法改名 / 移动
    // （knowledge/windows-and-tooling.md）；扫描 + 缓存只在一次枚举期间持有句柄
    const a = path.join(project, 'A')
    const moved = path.join(project, 'A2')
    mkdirSync(path.join(a, 'B', 'C'), { recursive: true })
    writeFileSync(path.join(a, 'B', 'C', 'c.txt'), 'c')
    const { app, page } = await launchFast(userData)
    try {
      const { id: workspaceId } = await data(page, 'workspace.active')
      await data(page, 'entry.add', { kind: 'folder', workspaceId, parentId: null, path: project })
      const tree = page.getByRole('tree')
      // 双击：展开并在标签中打开（最后标签与选中都在 C：C 为关注点）
      for (const name of ['案件', 'A', 'B', 'C']) {
        await tree.getByRole('treeitem', { name, exact: true }).dblclick()
      }
      await expect(tree.getByRole('treeitem', { name: 'c.txt' })).toBeVisible()
      // 应用确实在扫描 A\B\C：经过至少 2 个刷新间隔（launchFast 设为 2 秒）
      await page.waitForTimeout(4500)

      // 改名期间扫描照常进行（关注点 C 与可见的已展开目录按 2 秒间隔检查）。
      // 恰好与一次毫秒级的枚举重叠时改名可能失败（设计 4.2）：单次失败允许重试一次，并记录下来
      const retries: string[] = []
      const rename = async (from: string, to: string): Promise<void> => {
        try {
          renameSync(from, to)
        } catch (e) {
          retries.push(`${path.basename(from)} → ${path.basename(to)}: ${(e as Error).message}`)
          await page.waitForTimeout(300)
          renameSync(from, to)
        }
      }
      for (let i = 0; i < 10; i++) {
        await rename(a, moved)
        await page.waitForTimeout(300)
        await rename(moved, a)
        await page.waitForTimeout(300)
      }
      test.info().annotations.push({
        type: 'rename retries',
        description: retries.length === 0 ? 'none' : retries.join('; ')
      })
      console.log(`[principle] rename retries: ${retries.length}`, retries)

      // 改回原名后树照常显示
      await expect(tree.getByRole('treeitem', { name: 'c.txt' })).toBeVisible({ timeout: 8000 })
    } finally {
      await app.close()
    }
  })

  test('cache: an expanded directory shows the cached listing first and the change after the next check', async () => {
    const { app, page } = await launchFast(userData)
    try {
      const { id: workspaceId } = await data(page, 'workspace.active')
      await data(page, 'entry.add', { kind: 'folder', workspaceId, parentId: null, path: project })
      const design = path.join(project, '設計書')
      const designUri = pathToFileURL(design).href
      const names = (l: Listing): string[] => l.items.map((i) => i.name)

      // 树中尚未展开、未选中：该子目录不在调度范围内。首次列出 → 枚举后存入缓存
      const first = await data<Listing>(page, 'vfs.list', { uri: designUri })
      expect(names(first)).toEqual(['仕様.xlsx'])

      // 磁盘上的变化；超过刷新间隔（2 秒）后再列出：先返回缓存（不含新文件），状态为 cached
      writeFileSync(path.join(design, '追加.txt'), '')
      await page.waitForTimeout(3000)
      const second = await data<Listing>(page, 'vfs.list', { uri: designUri })
      expect(second.state).toBe('cached')
      expect(names(second)).toEqual(['仕様.xlsx'])

      // 那次列出同时安排了检查：树中展开后显示新文件（无需手动刷新）
      const tree = page.getByRole('tree')
      await tree.getByRole('treeitem', { name: '案件' }).dblclick()
      await tree.getByRole('treeitem', { name: '設計書' }).dblclick()
      await expect(tree.getByRole('treeitem', { name: '仕様.xlsx' })).toBeVisible()
      await expect(tree.getByRole('treeitem', { name: '追加.txt' })).toBeVisible({ timeout: 5000 })

      // 展开中的目录按刷新间隔检查：新建 / 删除无需手动刷新即出现 / 消失
      writeFileSync(path.join(design, '新規.txt'), '')
      rmSync(path.join(project, 'README.md'))
      await expect(tree.getByRole('treeitem', { name: '新規.txt' })).toBeVisible({ timeout: 8000 })
      await expect(tree.getByRole('treeitem', { name: 'README.md' })).toHaveCount(0, {
        timeout: 8000
      })

      // 展开中的真实子目录被删除：它与其子项从父目录的列表中消失
      rmSync(design, { recursive: true, force: true })
      await expect(tree.getByRole('treeitem', { name: '設計書' })).toHaveCount(0, {
        timeout: 8000
      })
      await expect(tree.getByRole('treeitem', { name: '仕様.xlsx' })).toHaveCount(0)
    } finally {
      await app.close()
    }
  })

  test('cache: a deleted entry directory shows not-found and recovers on retry after it is re-created', async () => {
    const { app, page } = await launchFast(userData)
    try {
      const { id: workspaceId } = await data(page, 'workspace.active')
      const minutes = path.join(project, '議事録')
      await data(page, 'entry.add', { kind: 'folder', workspaceId, parentId: null, path: minutes })
      await data(page, 'entry.add', { kind: 'folder', workspaceId, parentId: null, path: project })
      const tree = page.getByRole('tree')
      await tree.getByRole('treeitem', { name: '議事録' }).first().dblclick()
      await expect(tree.getByRole('treeitem', { name: '20261118.docx' })).toBeVisible()

      // 条目指向的目录在展开状态下被删除：下一次检查后显示「找不到」与「重试」，其他节点不受影响
      rmSync(minutes, { recursive: true, force: true })
      const errorRow = tree.getByRole('treeitem', { name: notFoundLabel })
      await expect(errorRow).toBeVisible({ timeout: 8000 })
      await expect(tree.getByRole('treeitem', { name: '20261118.docx' })).toHaveCount(0)
      await expect(tree.getByRole('treeitem', { name: '案件' })).toBeVisible()

      // 原路径重建 →「重试」（vfs.refresh + 重新获取）→ 列表恢复
      mkdirSync(minutes)
      writeFileSync(path.join(minutes, '復旧.txt'), '')
      await errorRow.getByRole('button', { name: retryButton }).click()
      await expect(tree.getByRole('treeitem', { name: '復旧.txt' })).toBeVisible({ timeout: 5000 })
      await expect(errorRow).toHaveCount(0)
    } finally {
      await app.close()
    }
  })

  test('focus: refocusing the window does not show loading for a cached directory', async () => {
    const { app, page } = await launchFast(userData)
    try {
      const { id: workspaceId } = await data(page, 'workspace.active')
      await data(page, 'entry.add', { kind: 'folder', workspaceId, parentId: null, path: project })
      const tree = page.getByRole('tree')
      await tree.getByRole('treeitem', { name: '案件' }).dblclick()
      await tree.getByRole('treeitem', { name: '設計書' }).dblclick()
      await expect(tree.getByRole('treeitem', { name: '仕様.xlsx' })).toBeVisible()

      // 从这里开始记录树中是否出现过「加载中」行
      await page.evaluate(() => {
        const w = window as unknown as { sawLoading: boolean }
        w.sawLoading = false
        const el = document.querySelector('[role="tree"]')!
        const check = (): void => {
          if (/読み込み中|正在加载|Loading/.test(el.textContent ?? '')) w.sawLoading = true
        }
        new MutationObserver(check).observe(el, {
          subtree: true,
          childList: true,
          characterData: true
        })
      })

      // 失焦 → 磁盘变化 → 重新获得焦点。Playwright 产生不了真实的焦点切换（knowledge/testing.md），
      // 直接触发 BrowserWindow 的 blur / focus（主进程据此通知扫描进程），页面上同时派发 focus
      const emit = (event: 'blur' | 'focus'): Promise<void> =>
        app.evaluate(({ BrowserWindow }, e) => {
          BrowserWindow.getAllWindows()[0]!.emit(e)
        }, event)
      await emit('blur')
      writeFileSync(path.join(project, '設計書', '追加.txt'), '')
      await page.waitForTimeout(500)
      await emit('focus')
      await page.evaluate(() => window.dispatchEvent(new Event('focus')))

      // 缓存内容一直显示，检查后出现新文件；期间没有「加载中」
      await expect(tree.getByRole('treeitem', { name: '追加.txt' })).toBeVisible({ timeout: 8000 })
      await expect(tree.getByRole('treeitem', { name: '仕様.xlsx' })).toBeVisible()
      expect(
        await page.evaluate(() => (window as unknown as { sawLoading: boolean }).sawLoading)
      ).toBe(false)
    } finally {
      await app.close()
    }
  })

  test('collapse: changes made while a directory was collapsed appear when it is expanded again', async () => {
    const { app, page } = await launchFast(userData)
    try {
      const { id: workspaceId } = await data(page, 'workspace.active')
      await data(page, 'entry.add', { kind: 'folder', workspaceId, parentId: null, path: project })
      // 单击只选中（不在标签中打开）：本用例验证的是资源树自己的查询，标签中的目录视图会另外重新列出
      await data(page, 'settings.set', { 'explorer.singleClickPreview': false })
      const tree = page.getByRole('tree')
      await toggleRow(tree.getByRole('treeitem', { name: '案件' }))
      const design = tree.getByRole('treeitem', { name: '設計書' })
      await design.click()
      await toggleRow(design)
      await expect(tree.getByRole('treeitem', { name: '仕様.xlsx' })).toBeVisible()

      // 折叠：查询变为非活动（渲染端的缓存保留）；该目录仍是关注点（选中），扫描进程照常检查
      await toggleRow(design)
      await expect(tree.getByRole('treeitem', { name: '仕様.xlsx' })).toHaveCount(0)
      writeFileSync(path.join(project, '設計書', '追加.txt'), '')
      // 等下一次检查发现变化（vfs.changed 让非活动查询失效）后再展开：重新列出，而不是显示折叠前的列表
      await page.waitForTimeout(3000)
      await toggleRow(design)
      await expect(tree.getByRole('treeitem', { name: '追加.txt' })).toBeVisible({ timeout: 5000 })
      await expect(tree.getByRole('treeitem', { name: '仕様.xlsx' })).toBeVisible()
    } finally {
      await app.close()
    }
  })

  test('workspace switch: directories are re-listed when switching back to a workspace', async () => {
    const { app, page } = await launchFast(userData)
    try {
      const { id: workspaceId } = await data(page, 'workspace.active')
      await data(page, 'entry.add', { kind: 'folder', workspaceId, parentId: null, path: project })
      const tree = page.getByRole('tree')
      await toggleRow(tree.getByRole('treeitem', { name: '案件' }))
      await expect(tree.getByRole('treeitem', { name: 'README.md' })).toBeVisible()

      // 切到另一个（空的）工作区：资源树卸载（发送空关注点），旧工作区的根不再调度（缓存保留）
      const other = await data(page, 'workspace.create', { name: '別件' })
      await data(page, 'workspace.activate', { id: other.id })
      await expect(page.getByRole('treeitem', { name: '案件' })).toHaveCount(0)
      await page.waitForTimeout(1000)
      writeFileSync(path.join(project, '新規.txt'), '')
      await page.waitForTimeout(2500)

      // 切回：展开状态保留；根重新参与调度，检查发现变化后重新列出
      await data(page, 'workspace.activate', { id: workspaceId })
      await expect(tree.getByRole('treeitem', { name: '新規.txt' })).toBeVisible({ timeout: 5000 })
      await expect(tree.getByRole('treeitem', { name: 'README.md' })).toBeVisible()
    } finally {
      await app.close()
    }
  })

  test('drag and drop only manages entries: the disk snapshot is identical afterwards', async () => {
    const { app, page } = await launchFast(userData)
    try {
      const { id: workspaceId } = await data(page, 'workspace.active')
      const readme = path.join(project, 'README.md')
      await data(page, 'entry.add', { kind: 'folder', workspaceId, parentId: null, path: project })
      // 标签与「案件」下的真实文件 README.md 区分开
      await data(page, 'entry.add', {
        kind: 'file',
        workspaceId,
        parentId: null,
        path: readme,
        label: 'メモ'
      })
      const group = await data(page, 'entry.add', {
        kind: 'group',
        workspaceId,
        parentId: null,
        label: 'ログ'
      })
      const entries = (): Promise<Entry[]> => data<Entry[]>(page, 'entry.list', { workspaceId })
      const tree = page.getByRole('tree')
      await toggleRow(tree.getByRole('treeitem', { name: '案件' }))
      await toggleRow(tree.getByRole('treeitem', { name: '設計書' }))
      await expect(tree.getByRole('treeitem', { name: '仕様.xlsx' })).toBeVisible()

      // 递归快照（路径 + 类型 + 大小 + mtime）在所有拖放之前取一次，最后比较
      const before = snapshotTree(files)

      // 条目 → 条目：「メモ」（根条目）拖到「案件」之前
      const reorder = await dragRow(page, 'メモ', { row: '案件', at: 'top' })
      expect(reorder).toEqual({ types: ['application/x-pch-node'], accepted: true })
      await expect
        .poll(async () => (await entries()).filter((e) => !e.parentId).map((e) => e.label))
        .toEqual(['メモ', '案件', 'ログ'])

      // 条目 → 分组内部
      expect(await dragRow(page, 'メモ', { row: 'ログ', at: 'middle' })).toMatchObject({
        accepted: true
      })
      await expect
        .poll(async () => (await entries()).find((e) => e.label === 'メモ')?.parentId)
        .toBe(group.id)

      // 真实子目录 → 根（空白处）：「固定」为新的 folder 条目（按 URI 添加），原目录不动
      const pin = await dragRow(page, '設計書', null)
      expect(pin).toEqual({ types: ['application/x-pch-node'], accepted: true })
      await expect
        .poll(async () => (await entries()).filter((e) => !e.parentId).map((e) => e.label))
        .toEqual(['案件', 'ログ', '設計書'])
      const pinned = (await entries()).find((e) => e.label === '設計書' && !e.parentId)!
      expect(pinned).toMatchObject({ kind: 'folder' })
      expect(decodeURIComponent(pinned.uri)).toMatch(/\/案件\/設計書$/)

      // 真实子目录拖到某个根条目之前：按松手位置插入（不再追加到末尾），同级顺序重排
      expect(await dragRow(page, '議事録', { row: '案件', at: 'top' })).toMatchObject({
        accepted: true
      })
      await expect
        .poll(async () => (await entries()).filter((e) => !e.parentId).map((e) => e.label))
        .toEqual(['議事録', '案件', 'ログ', '設計書'])

      // 根下显示为未分组在上、分组在下（设计 2.7）：落在分组「ログ」的上缘 = 未分组条目的末尾
      expect(await dragRow(page, 'README.md', { row: 'ログ', at: 'top' })).toMatchObject({
        accepted: true
      })
      await expect
        .poll(async () => (await entries()).filter((e) => !e.parentId).map((e) => e.label))
        .toEqual(['議事録', '案件', 'ログ', '設計書', 'README.md'])
      await expect(tree.locator('[role="treeitem"][aria-level="1"]')).toHaveText([
        '議事録',
        '案件',
        '設計書',
        'README.md',
        'ログ'
      ])

      // 落在真实节点上一律不接受（dragover 不 preventDefault，drop 不会发生）
      // （同名的行中第一个是「案件」下的真实文件 README.md）
      expect(await dragRow(page, '仕様.xlsx', { row: 'README.md', at: 'middle' })).toMatchObject({
        accepted: false
      })
      expect(await dragRow(page, 'ログ', { row: '仕様.xlsx', at: 'top' })).toMatchObject({
        accepted: false
      })

      // 条目数据只因上面被接受的拖放而变化（案件、メモ、ログ + 固定的 設計書、議事録、README.md）；磁盘完全不变
      expect(await entries()).toHaveLength(6)
      expect(snapshotTree(files)).toEqual(before)
    } finally {
      await app.close()
    }
  })

  /** 右键 → 缓存策略子菜单（点击触发器展开），返回子菜单中的单选项 */
  async function openLevelMenu(
    page: Page,
    row: string
  ): Promise<(name: RegExp) => ReturnType<Page['getByRole']>> {
    await page.getByRole('tree').getByRole('treeitem', { name: row }).click({ button: 'right' })
    await page.getByRole('menuitem', { name: /^(キャッシュ方針|缓存策略|Cache strategy)/ }).click()
    return (name) => page.getByRole('menuitemradio', { name })
  }

  test('menu: cache strategy and build index', async () => {
    const { app, page } = await launchFast(userData)
    try {
      const { id: workspaceId } = await data(page, 'workspace.active')
      await data(page, 'entry.add', { kind: 'folder', workspaceId, parentId: null, path: project })
      const tree = page.getByRole('tree')
      const rootUri = pathToFileURL(project).href
      const entries = (): Promise<(Entry & { cacheStrategy: string | null })[]> =>
        data(page, 'entry.list', { workspaceId })

      // 初始：跟随全局（本地全局默认为 積極 / 积极 / Active）被选中
      let radio = await openLevelMenu(page, '案件')
      await expect(
        radio(/^(全体設定に従う|跟随全局|Use global setting).*(積極|积极|Active)/)
      ).toBeChecked()
      await page.keyboard.press('Escape')
      await page.keyboard.press('Escape')

      // 选择「全部」→ 保存到条目，菜单关闭
      radio = await openLevelMenu(page, '案件')
      await radio(/^(すべて|全部|All)$/).click()
      await expect(page.getByRole('menu')).toHaveCount(0)
      await expect
        .poll(async () => (await entries()).find((e) => e.label === '案件')?.cacheStrategy)
        .toBe('all')

      // 重新打开：「全部」为选中
      radio = await openLevelMenu(page, '案件')
      await expect(radio(/^(すべて|全部|All)$/)).toBeChecked()
      await page.keyboard.press('Escape')
      await page.keyboard.press('Escape')

      // 建立索引：勾选 → index.list 含该目录；重新打开显示已勾选
      await tree.getByRole('treeitem', { name: '案件' }).click({ button: 'right' })
      const build = page.getByRole('menuitemcheckbox', {
        name: /^(インデックスを作成|建立索引|Build index)/
      })
      await expect(build).not.toBeChecked()
      await build.click()
      await expect
        .poll(() => data<string[]>(page, 'index.list', { workspaceId }))
        .toEqual([rootUri])
      await tree.getByRole('treeitem', { name: '案件' }).click({ button: 'right' })
      await expect(build).toBeChecked()
      await page.keyboard.press('Escape')

      // 真实子目录也可以建立索引；没有「用默认应用打开」
      await toggleRow(tree.getByRole('treeitem', { name: '案件' }))
      await tree.getByRole('treeitem', { name: '設計書' }).click({ button: 'right' })
      await expect(
        page.getByRole('menuitem', {
          name: /既定のアプリで開く|用默认应用打开|Open with default app/
        })
      ).toHaveCount(0)
      await page
        .getByRole('menuitemcheckbox', { name: /^(インデックスを作成|建立索引|Build index)/ })
        .click()
      await expect
        .poll(async () => (await data<string[]>(page, 'index.list', { workspaceId })).length)
        .toBe(2)
    } finally {
      await app.close()
    }
  })

  test('offline: a root on an unreachable share shows the disconnected icon and its cached rows', async () => {
    const { app, page } = await launchFast(userData)
    try {
      const { id: workspaceId } = await data(page, 'workspace.active')
      await data(page, 'entry.add', { kind: 'folder', workspaceId, parentId: null, path: project })
      const tree = page.getByRole('tree')
      const root = tree.getByRole('treeitem', { name: '案件' })
      await toggleRow(root)
      await expect(tree.getByRole('treeitem', { name: 'README.md' })).toBeVisible()
      const icon = root.getByRole('img', { name: /^(切断|已断开|Disconnected)$/ })
      await expect(icon).toHaveCount(0)

      // 主进程测试钩子：以与产品相同的信封向窗口发出 vfs.reachability（不新增产品 IPC）
      const share = `${path.parse(project).root[0]!.toUpperCase()}:`
      const send = (state: 'offline' | 'online'): Promise<void> =>
        app.evaluate(
          ({ BrowserWindow }, e) => {
            for (const w of BrowserWindow.getAllWindows()) {
              w.webContents.send('pch:event', { event: 'vfs.reachability', payload: e })
            }
          },
          { share, state, since: Date.now() }
        )

      await send('offline')
      await expect(icon).toBeVisible()
      // 其下行仍显示缓存内容，文字为浅色
      await expect(tree.getByRole('treeitem', { name: 'README.md' })).toBeVisible()
      await expect(
        tree.getByRole('treeitem', { name: 'README.md' }).locator('span').first()
      ).toHaveClass(/text-muted-foreground/)

      await send('online')
      await expect(icon).toHaveCount(0)
      await expect(
        tree.getByRole('treeitem', { name: 'README.md' }).locator('span').first()
      ).not.toHaveClass(/text-muted-foreground/)
    } finally {
      await app.close()
    }
  })
})
