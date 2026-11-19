import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { expect, test, type Page } from '@playwright/test'
import { data, launch } from './support'

const searchView = /^(検索|搜索|Search)$/
const explorerView = /^(エクスプローラー|资源管理器|Explorer)$/
const searchBox = /^(ファイル名|文件名|File name)$/
const noResults = /(見つかりませんでした|没有找到|No results)/

/** folder 条目 + 搜索视图的输入框 */
async function openSearch(page: Page): Promise<ReturnType<Page['getByRole']>> {
  await page.getByRole('button', { name: searchView }).click()
  const input = page.getByRole('searchbox', { name: searchBox })
  await expect(input).toBeFocused()
  return input
}

test.describe('file name search view', () => {
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
    writeFileSync(path.join(project, '設計書', '設計メモ.txt'), 'memo')
    writeFileSync(path.join(project, '議事録', '20261118.docx'), 'minutes')
    writeFileSync(path.join(project, 'README.md'), '# 案件')
  })
  test.afterEach(() => {
    rmSync(userData, { recursive: true, force: true })
    rmSync(files, { recursive: true, force: true })
  })

  /** 添加 folder 条目并经 vfs.list 列出各目录（搜索只查缓存：列出过的目录才搜得到） */
  async function setup(page: Page): Promise<string> {
    const { id: workspaceId } = await data(page, 'workspace.active')
    await data(page, 'entry.add', { kind: 'folder', workspaceId, parentId: null, path: project })
    for (const dir of [project, path.join(project, '設計書'), path.join(project, '議事録')]) {
      await data(page, 'vfs.list', { uri: pathToFileURL(dir).href })
    }
    return workspaceId
  }

  test('search: typing shows matches from the cache and Enter reveals the row in the tree', async () => {
    const { app, page } = await launch(userData)
    try {
      await setup(page)
      // 树中只有折叠的条目：定位需要展开「案件 › 議事録」
      const tree = page.getByRole('tree')
      await expect(tree.getByRole('treeitem', { name: '案件' })).toHaveAttribute(
        'aria-expanded',
        'false'
      )

      const input = await openSearch(page)
      await input.fill('2026')
      const results = page.getByRole('listbox')
      const hit = results.getByRole('option', { name: /20261118\.docx/ })
      await expect(hit).toBeVisible()
      // 第二行为「条目标签 › 父目录」，匹配片段高亮
      await expect(hit).toContainText('案件 › 議事録')
      await expect(hit.locator('mark')).toHaveText('2026')
      await expect(
        page.getByRole('status').filter({ hasText: /^(1 件|1 项|1 found)/ })
      ).toBeVisible()

      await input.press('ArrowDown')
      await expect(results).toBeFocused()
      await page.keyboard.press('Enter')

      const row = tree.getByRole('treeitem', { name: '20261118.docx' })
      await expect(row).toHaveAttribute('aria-selected', 'true')
      await expect(tree.getByRole('treeitem', { name: '議事録' })).toHaveAttribute(
        'aria-expanded',
        'true'
      )
      await expect(tree).toBeFocused()
      await page.screenshot({ path: 'test-results/search-revealed.png' })

      // 切回搜索视图：输入与结果保留
      await page.getByRole('button', { name: searchView }).click()
      await expect(page.getByRole('searchbox', { name: searchBox })).toHaveValue('2026')
      await expect(page.getByRole('option', { name: /20261118\.docx/ })).toBeVisible()
    } finally {
      await app.close()
    }
  })

  test('search: kind filter', async () => {
    const { app, page } = await launch(userData)
    try {
      await setup(page)
      const input = await openSearch(page)
      // 2 个字符的短词（不走 trigram 索引）
      await input.fill('設計')
      const results = page.getByRole('listbox')
      await expect(results.getByRole('option')).toHaveCount(2)

      await page.getByRole('tab', { name: /^(ファイル|文件|Files)$/ }).click()
      await expect(results.getByRole('option')).toHaveCount(1)
      await expect(results.getByRole('option')).toContainText('設計メモ.txt')

      await page.getByRole('tab', { name: /^(フォルダー|文件夹|Folders)$/ }).click()
      await expect(results.getByRole('option')).toHaveCount(1)
      await expect(results.getByRole('option')).toContainText('設計書')

      const all = page.getByRole('tab', { name: /^(すべて|全部|All)$/ })
      await all.click()
      await expect(results.getByRole('option')).toHaveCount(2)
      // 再次点击已选中的项不会取消选择
      await all.click()
      await expect(all).toHaveAttribute('aria-selected', 'true')
      await expect(results.getByRole('option')).toHaveCount(2)
    } finally {
      await app.close()
    }
  })

  test('search: no results', async () => {
    const { app, page } = await launch(userData)
    try {
      await setup(page)
      const input = await openSearch(page)
      await input.fill('*.pdf')
      await expect(page.getByText(noResults)).toBeVisible()
      await expect(page.getByRole('option')).toHaveCount(0)
      // 清空后回到说明
      await page.getByRole('button', { name: /^(クリア|清除|Clear)$/ }).click()
      await expect(input).toHaveValue('')
      await expect(page.getByText(noResults)).toBeHidden()
    } finally {
      await app.close()
    }
  })

  test('search: Ctrl+Shift+F focuses the input', async () => {
    const { app, page } = await launch(userData)
    try {
      await setup(page)
      await page.getByRole('tree').getByRole('treeitem', { name: '案件' }).click()
      await expect(page.getByRole('tree')).toBeFocused()
      await page.keyboard.press('Control+Shift+F')
      const input = page.getByRole('searchbox', { name: searchBox })
      await expect(input).toBeFocused()
      await page.keyboard.type('仕様')
      await expect(page.getByRole('option', { name: /仕様\.xlsx/ })).toBeVisible()

      // 搜索视图已显示时再按一次：不折叠侧栏，焦点回到搜索框
      await page.getByRole('option', { name: /仕様\.xlsx/ }).click()
      await expect(page.getByRole('tree')).toBeFocused()
      await page.keyboard.press('Control+Shift+F')
      await expect(input).toBeFocused()
      await expect(input).toHaveValue('仕様')
      await page.keyboard.press('Control+Shift+F')
      await expect(input).toBeVisible()
      await expect(input).toBeFocused()
      await page.getByRole('button', { name: explorerView }).click()
      await expect(page.getByRole('tree')).toBeVisible()
    } finally {
      await app.close()
    }
  })

  test('search: right-click a result to copy its path', async () => {
    const { app, page } = await launch(userData)
    try {
      await setup(page)
      const input = await openSearch(page)
      await input.fill('仕様')
      await page.getByRole('option', { name: /仕様\.xlsx/ }).click({ button: 'right' })
      await page.getByRole('menuitem', { name: /^(パスをコピー|复制路径|Copy path)$/ }).click()
      await expect
        .poll(() => app.evaluate(({ clipboard }) => clipboard.readText()))
        .toBe(path.join(project, '設計書', '仕様.xlsx'))
    } finally {
      await app.close()
    }
  })

  test('search: window screenshots (light ja, dark zh-CN, light en)', async () => {
    const { app, page } = await launch(userData)
    try {
      await setup(page)
      const input = await openSearch(page)
      await page.screenshot({ path: 'test-results/search-empty.png' })
      await input.fill('設計')
      await expect(page.getByRole('option')).toHaveCount(2)
      const shots: [string, string, string][] = [
        ['light', 'ja', 'search-light-ja'],
        ['dark', 'zh-CN', 'search-dark-zh-CN'],
        ['light', 'en', 'search-light-en']
      ]
      for (const [theme, language, name] of shots) {
        await data(page, 'settings.set', {
          'appearance.themeMode': theme,
          'general.language': language
        })
        await expect(page.locator('html')).toHaveAttribute('lang', language)
        await expect(page.getByRole('searchbox', { name: searchBox })).toBeVisible()
        // 等主题切换的过渡动画结束再截图
        await page.waitForTimeout(800)
        await page.screenshot({ path: `test-results/${name}.png` })
      }
    } finally {
      await app.close()
    }
  })
})
