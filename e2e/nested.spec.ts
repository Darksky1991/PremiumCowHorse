import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { data, launchFast, type Named, removeDirs, toggleRow } from './support'

type Hit = { entryId: string; relativePath: string; name: string }
type SearchResult = { items: Hit[]; total: number }

let seq = 0
/** 经 IPC 搜索（只查缓存） */
const search = (page: Page, workspaceId: string, text: string): Promise<SearchResult> =>
  data<SearchResult>(page, 'search.query', {
    workspaceId,
    text,
    kind: 'all',
    requestId: `nested-${++seq}`
  })

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** 指定层级（aria-level）与名称的树行 */
const row = (page: Page, level: number, name: string): Locator =>
  page
    .getByRole('tree')
    .locator(`[role="treeitem"][aria-level="${level}"]`)
    .filter({ hasText: new RegExp(`^${escapeRegExp(name)}$`) })

/** 任意层级中名称完全一致的树行 */
const anyRow = (page: Page, name: string): Locator =>
  page.getByRole('tree').getByRole('treeitem', { name, exact: true })

/** 行未展开时点击箭头展开（箭头会切换展开状态，不能盲点；只展开，不选中、不打开标签） */
async function expand(r: Locator): Promise<void> {
  await expect(r).toBeVisible()
  if ((await r.getAttribute('aria-expanded')) === 'false') await toggleRow(r)
  await expect(r).toHaveAttribute('aria-expanded', 'true')
}

test.describe('nested entries and ancestor rename', () => {
  let userData: string
  let files: string

  test.beforeEach(() => {
    userData = mkdtempSync(path.join(tmpdir(), 'pch-e2e-'))
    files = mkdtempSync(path.join(tmpdir(), 'pch-e2e-files-'))
  })
  test.afterEach(() => {
    removeDirs(userData, files)
  })

  test('a parent, child and grandchild directory can all be entries: one cache, consistent everywhere', async () => {
    const P = path.join(files, 'P')
    const C = path.join(P, 'C')
    const G = path.join(C, 'G')
    mkdirSync(path.join(G, 'sub'), { recursive: true })
    writeFileSync(path.join(P, 'p.txt'), '')
    writeFileSync(path.join(C, 'c.txt'), '')
    writeFileSync(path.join(G, 'g.txt'), '')
    writeFileSync(path.join(G, 'sub', 's.txt'), '')
    const { app, page } = await launchFast(userData)
    try {
      const { id: workspaceId } = await data(page, 'workspace.active')
      const add = (p: string): Promise<Named> =>
        data(page, 'entry.add', { kind: 'folder', workspaceId, parentId: null, path: p })
      const entryP = await add(P)
      await add(C)
      const entryG = await add(G)

      // 三个条目各自展开到 G 之下：P › C › G、C › G、G
      await expand(row(page, 1, 'P'))
      await expand(row(page, 2, 'C'))
      await expand(row(page, 3, 'G'))
      await expand(row(page, 1, 'C'))
      await expand(row(page, 2, 'G'))
      await expand(row(page, 1, 'G'))
      await expect(anyRow(page, 'g.txt')).toHaveCount(3)
      await expand(row(page, 4, 'sub'))
      await expand(row(page, 3, 'sub'))
      await expand(row(page, 2, 'sub'))
      await expect(anyRow(page, 's.txt')).toHaveCount(3)

      // 外部新建 / 删除文件：三处都更新
      writeFileSync(path.join(G, 'new.txt'), '')
      rmSync(path.join(G, 'g.txt'))
      await expect(anyRow(page, 'new.txt')).toHaveCount(3, { timeout: 15000 })
      await expect(anyRow(page, 'g.txt')).toHaveCount(0, { timeout: 15000 })

      // 搜索：同一目录只出现一次，归属最内层条目 G，路径相对 G
      await expect
        .poll(async () =>
          (await search(page, workspaceId, 'new.txt')).items.map((i) => [i.entryId, i.relativePath])
        )
        .toEqual([[entryG.id, 'new.txt']])
      expect((await search(page, workspaceId, 's.txt')).items.map((i) => i.relativePath)).toEqual([
        'sub/s.txt'
      ])

      // 移除最外层条目 P：C、G 仍能展开，内容正确
      await data(page, 'entry.remove', { id: entryP.id })
      await expect(row(page, 1, 'P')).toHaveCount(0)
      await expand(row(page, 1, 'C'))
      await expand(row(page, 2, 'G'))
      await expand(row(page, 1, 'G'))
      await expect(anyRow(page, 'new.txt')).toHaveCount(2)
      await expect(row(page, 2, 'c.txt')).toBeVisible()
      await expect(anyRow(page, 'g.txt')).toHaveCount(0)
      // 外部再改一次，两处仍更新
      writeFileSync(path.join(G, 'later.txt'), '')
      await expect(anyRow(page, 'later.txt')).toHaveCount(2, { timeout: 15000 })

      // 把 P 添加回来：正常展开
      await add(P)
      await expand(row(page, 1, 'P'))
      await expand(row(page, 2, 'C'))
      await expand(row(page, 3, 'G'))
      await expect(anyRow(page, 'later.txt')).toHaveCount(3)
      await expect(row(page, 2, 'p.txt')).toBeVisible()

      // 外部删除 G 下的子目录：缓存清理，树中消失，搜索不再出现
      rmSync(path.join(G, 'sub'), { recursive: true, force: true })
      await expect(anyRow(page, 'sub')).toHaveCount(0, { timeout: 15000 })
      await expect(anyRow(page, 's.txt')).toHaveCount(0)
      await expect
        .poll(async () => (await search(page, workspaceId, 's.txt')).items.length, {
          timeout: 15000
        })
        .toBe(0)
      expect((await search(page, workspaceId, 'sub')).items).toHaveLength(0)
      // 其余内容不受影响
      expect((await search(page, workspaceId, 'later.txt')).items.map((i) => i.entryId)).toEqual([
        entryG.id
      ])
    } finally {
      await app.close()
    }
  })

  test('renaming an ancestor and not renaming it back: the tree and search follow the new name', async () => {
    // 窗口焦点：Playwright 下窗口默认聚焦，失焦时才会暂停定期确认，所以这里不需要模拟 focus
    const project = path.join(files, '案件')
    const a = path.join(project, 'A')
    mkdirSync(path.join(a, 'B', 'C'), { recursive: true })
    writeFileSync(path.join(a, 'B', 'C', 'c.txt'), 'c')
    const { app, page } = await launchFast(userData)
    try {
      const { id: workspaceId } = await data(page, 'workspace.active')
      const entry = await data(page, 'entry.add', {
        kind: 'folder',
        workspaceId,
        parentId: null,
        path: project
      })
      await expand(row(page, 1, '案件'))
      await expand(row(page, 2, 'A'))
      await expand(row(page, 3, 'B'))
      await expand(row(page, 4, 'C'))
      await expect(row(page, 5, 'c.txt')).toBeVisible()
      // 选中 C（关注点）：单击只选中（并在标签中打开），不折叠
      await row(page, 4, 'C').click()
      await expect(row(page, 4, 'C')).toHaveAttribute('aria-selected', 'true')
      await expect(row(page, 5, 'c.txt')).toBeVisible()
      await expect.poll(async () => (await search(page, workspaceId, 'c.txt')).items.length).toBe(1)

      // 改名不改回；与一次毫秒级的枚举重叠时改名可能失败：重试一次
      try {
        renameSync(a, path.join(project, 'A2'))
      } catch {
        await page.waitForTimeout(300)
        renameSync(a, path.join(project, 'A2'))
      }

      // 2 秒间隔下，上限 20 秒：A 消失、A2 出现
      await expect(row(page, 2, 'A')).toHaveCount(0, { timeout: 20000 })
      await expect(row(page, 2, 'A2')).toBeVisible({ timeout: 20000 })
      await expand(row(page, 2, 'A2'))
      await expand(row(page, 3, 'B'))
      await expect(row(page, 4, 'C')).toBeVisible()
      await expand(row(page, 4, 'C'))
      await expect(row(page, 5, 'c.txt')).toBeVisible()

      // 搜索：只有 A2 之下的结果
      await expect
        .poll(
          async () =>
            (await search(page, workspaceId, 'c.txt')).items.map((i) => [
              i.entryId,
              i.relativePath
            ]),
          { timeout: 20000 }
        )
        .toEqual([[entry.id, 'A2/B/C/c.txt']])
    } finally {
      await app.close()
    }
  })
})
