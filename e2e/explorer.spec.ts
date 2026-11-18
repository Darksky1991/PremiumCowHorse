import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { data, launch, snapshotTree, type Named } from './support'

/** 「找不到」错误行的文案（errors:FS_NOT_FOUND，ja | zh-CN | en） */
const notFoundLabel =
  /(ファイルまたはフォルダーが見つかりません|找不到文件或文件夹|File or folder not found)/
const retryButton = /^(再試行|重试|Retry)$/

type Entry = Named & { kind: string; parentId: string | null }

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
    rmSync(userData, { recursive: true, force: true })
    rmSync(files, { recursive: true, force: true })
  })

  test('watch: files created on disk appear in expanded directories without a manual refresh', async () => {
    const { app, page } = await launch(userData)
    try {
      const { id: workspaceId } = await data(page, 'workspace.active')
      await data(page, 'entry.add', { kind: 'folder', workspaceId, parentId: null, path: project })
      const tree = page.getByRole('tree')
      await tree.getByRole('treeitem', { name: '案件' }).click()
      await tree.getByRole('treeitem', { name: '設計書' }).click()
      await expect(tree.getByRole('treeitem', { name: '仕様.xlsx' })).toBeVisible()
      // 监听集合在展开后经 200ms 防抖才发给主进程；在那之前的变化只能靠刷新 / 窗口聚焦发现
      await page.waitForTimeout(1000)

      // 根条目目录与展开中的子目录都在监听：新建的文件 / 目录无需刷新即出现
      writeFileSync(path.join(project, '設計書', '追加.txt'), '')
      mkdirSync(path.join(project, '新規フォルダー'))
      await expect(tree.getByRole('treeitem', { name: '追加.txt' })).toBeVisible({ timeout: 5000 })
      await expect(tree.getByRole('treeitem', { name: '新規フォルダー' })).toBeVisible({
        timeout: 5000
      })

      // 删除同样被感知
      rmSync(path.join(project, 'README.md'))
      await expect(tree.getByRole('treeitem', { name: 'README.md' })).toHaveCount(0, {
        timeout: 5000
      })
    } finally {
      await app.close()
    }
  })

  test('watch: deleting an expanded directory shows a not-found row and leaves other nodes alone', async () => {
    const { app, page } = await launch(userData)
    try {
      const { id: workspaceId } = await data(page, 'workspace.active')
      const design = path.join(project, '設計書')
      const minutes = path.join(project, '議事録')
      await data(page, 'entry.add', { kind: 'folder', workspaceId, parentId: null, path: design })
      await data(page, 'entry.add', { kind: 'folder', workspaceId, parentId: null, path: project })
      const tree = page.getByRole('tree')
      await tree.getByRole('treeitem', { name: '設計書' }).first().click()
      await expect(tree.getByRole('treeitem', { name: '仕様.xlsx' })).toBeVisible()
      await tree.getByRole('treeitem', { name: '案件' }).click()
      await tree.getByRole('treeitem', { name: '議事録' }).click()
      await expect(tree.getByRole('treeitem', { name: '20261118.docx' })).toBeVisible()
      await page.waitForTimeout(1000)

      // 条目指向的目录在展开状态下被删除：该节点显示「找不到」与「重试」，无需手动刷新
      rmSync(design, { recursive: true, force: true })
      const errorRow = tree.getByRole('treeitem', { name: notFoundLabel })
      await expect(errorRow).toBeVisible({ timeout: 5000 })
      await expect(errorRow.getByRole('button', { name: retryButton })).toBeVisible()
      await expect(tree.getByRole('treeitem', { name: '仕様.xlsx' })).toHaveCount(0)

      // 真实子目录在展开状态下被删除：它与其子项从父目录的列表中消失
      rmSync(minutes, { recursive: true, force: true })
      await expect(tree.getByRole('treeitem', { name: '議事録' })).toHaveCount(0, { timeout: 5000 })
      await expect(tree.getByRole('treeitem', { name: '20261118.docx' })).toHaveCount(0)

      // 其他节点不受影响，仍可操作
      await expect(tree.getByRole('treeitem', { name: 'README.md' })).toBeVisible()
      await expect(tree.getByRole('treeitem', { name: '案件' })).toHaveAttribute(
        'aria-expanded',
        'true'
      )
      await expect(tree.getByRole('treeitem', { name: notFoundLabel })).toHaveCount(1)
    } finally {
      await app.close()
    }
  })

  test('watch: a directory deleted, re-created and retried is watched again', async () => {
    const { app, page } = await launch(userData)
    try {
      const { id: workspaceId } = await data(page, 'workspace.active')
      const design = path.join(project, '設計書')
      await data(page, 'entry.add', { kind: 'folder', workspaceId, parentId: null, path: design })
      const tree = page.getByRole('tree')
      await tree.getByRole('treeitem', { name: '設計書' }).click()
      await expect(tree.getByRole('treeitem', { name: '仕様.xlsx' })).toBeVisible()
      await page.waitForTimeout(1000)

      // 删除 → 「找不到」行
      rmSync(design, { recursive: true, force: true })
      const errorRow = tree.getByRole('treeitem', { name: notFoundLabel })
      await expect(errorRow).toBeVisible({ timeout: 5000 })
      // 等渲染端收到 vfs.changed 后的重发（200ms 防抖）在目录不存在时完成，
      // 否则重建赶在重发之前，监听碰巧建立成功，测不到「重建后不恢复监听」
      await page.waitForTimeout(1500)

      // 原路径重建 → 「重试」→ 列表恢复（条目根的父目录不在监听中，重建本身不会被感知）
      mkdirSync(design)
      writeFileSync(path.join(design, '復旧.txt'), '')
      await errorRow.getByRole('button', { name: retryButton }).click()
      await expect(tree.getByRole('treeitem', { name: '復旧.txt' })).toBeVisible()
      // 列表恢复后监听集合重新包含该目录（经 200ms 防抖发送）
      await page.waitForTimeout(1000)

      // 之后的变化无需刷新即出现：监听已重新建立
      writeFileSync(path.join(design, '追加.txt'), '')
      await expect(tree.getByRole('treeitem', { name: '追加.txt' })).toBeVisible({ timeout: 5000 })
    } finally {
      await app.close()
    }
  })

  test('drag and drop only manages entries: the disk snapshot is identical afterwards', async () => {
    const { app, page } = await launch(userData)
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
      await tree.getByRole('treeitem', { name: '案件' }).click()
      await tree.getByRole('treeitem', { name: '設計書' }).click()
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

      // 落在真实节点上一律不接受（dragover 不 preventDefault，drop 不会发生）
      expect(await dragRow(page, '仕様.xlsx', { row: '議事録', at: 'middle' })).toMatchObject({
        accepted: false
      })
      expect(await dragRow(page, 'ログ', { row: '仕様.xlsx', at: 'top' })).toMatchObject({
        accepted: false
      })

      // 条目数据只因上面三次被接受的拖放而变化（案件、メモ、ログ + 固定的 設計書）；磁盘完全不变
      expect(await entries()).toHaveLength(4)
      expect(snapshotTree(files)).toEqual(before)
    } finally {
      await app.close()
    }
  })
})
