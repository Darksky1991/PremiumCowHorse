import { mkdirSync, mkdtempSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { data, launchFast, removeDirs } from './support'

/** 主进程中记录的系统操作（替换 shell 的方法，测试中不真的打开应用或资源管理器） */
type ShellCalls = { openPath: string[]; showItemInFolder: string[] }

/** 替换 shell.openPath / shell.showItemInFolder 为计数（必须在点击任何动作之前） */
async function stubShell(app: ElectronApplication): Promise<() => Promise<ShellCalls>> {
  await app.evaluate(({ shell }) => {
    const calls = { openPath: [] as string[], showItemInFolder: [] as string[] }
    ;(globalThis as unknown as { __pchShell: typeof calls }).__pchShell = calls
    Object.assign(shell, {
      openPath: async (p: string) => {
        calls.openPath.push(p)
        return ''
      },
      showItemInFolder: (p: string) => {
        calls.showItemInFolder.push(p)
      }
    })
  })
  return () => app.evaluate(() => (globalThis as unknown as { __pchShell: ShellCalls }).__pchShell)
}

test.describe('preview container and the fallback plugin', () => {
  let userData: string
  let files: string
  let project: string

  test.beforeEach(() => {
    userData = mkdtempSync(path.join(tmpdir(), 'pch-e2e-'))
    files = mkdtempSync(path.join(tmpdir(), 'pch-e2e-files-'))
    project = path.join(files, '案件')
    mkdirSync(path.join(project, '設計書'), { recursive: true })
    writeFileSync(path.join(project, 'memo.txt'), 'x'.repeat(1536))
    writeFileSync(path.join(project, 'run.bat'), '@echo off')
    writeFileSync(path.join(project, 'boom.crash'), 'crash')
    writeFileSync(path.join(project, 'bad.crashload'), 'crash on load')
  })
  test.afterEach(() => {
    removeDirs(userData, files)
  })

  /** 界面语言设为 en（断言固定文案），添加并展开条目「案件」，返回树 */
  async function setup(page: Page): Promise<Locator> {
    await data(page, 'settings.set', { 'general.language': 'en' })
    await expect(page.locator('html')).toHaveAttribute('lang', 'en')
    const { id: workspaceId } = await data(page, 'workspace.active')
    await data(page, 'entry.add', { kind: 'folder', workspaceId, parentId: null, path: project })
    const tree = page.getByRole('tree')
    // 单击展开（同时以预览标签打开目录）；关闭该标签，用例从没有标签开始
    await tree.getByRole('treeitem', { name: '案件' }).click()
    await expect(tree.getByRole('treeitem', { name: 'memo.txt' })).toBeVisible()
    await page.keyboard.press('Control+w')
    await expect(page.getByRole('tablist')).toHaveCount(0)
    return tree
  }

  const tab = (page: Page, name: string): Locator =>
    page.getByRole('tablist').getByRole('tab', { name, exact: true })
  const panel = (page: Page): Locator => page.getByRole('tabpanel')

  test('double click shows file info and three actions; executables ask before opening', async () => {
    const { app, page } = await launchFast(userData)
    try {
      const shellCalls = await stubShell(app)
      const tree = await setup(page)
      const memo = path.join(project, 'memo.txt')

      await tree.getByRole('treeitem', { name: 'memo.txt' }).dblclick()
      await expect(tab(page, 'memo.txt')).toHaveAttribute('aria-selected', 'true')
      const info = panel(page)
      await expect(info.getByRole('heading', { name: 'memo.txt' })).toBeVisible()
      await expect(info).toContainText(memo)
      await expect(info).toContainText('1.5 kB (1,536 bytes)')
      const expectedTime = await page.evaluate(
        (ms) =>
          new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'medium' }).format(ms),
        statSync(memo).mtimeMs
      )
      await expect(info).toContainText(expectedTime)

      // 非可执行文件：不确认，直接以本地路径调用 shell.openPath
      await info.getByRole('button', { name: 'Open with default app' }).click()
      await expect.poll(async () => (await shellCalls()).openPath).toEqual([memo])
      await expect(page.getByRole('alertdialog')).toHaveCount(0)

      await info.getByRole('button', { name: 'Reveal in File Explorer' }).click()
      await expect.poll(async () => (await shellCalls()).showItemInFolder).toEqual([memo])

      await info.getByRole('button', { name: 'Copy path' }).click()
      await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe(memo)
      await expect(page.getByText('Path copied')).toBeVisible()

      // 可执行类（.bat）：先确认；取消（按钮 / Esc）不调用 shell.openPath
      const bat = path.join(project, 'run.bat')
      await tree.getByRole('treeitem', { name: 'run.bat' }).dblclick()
      await expect(panel(page).getByRole('heading', { name: 'run.bat' })).toBeVisible()
      const open = panel(page).getByRole('button', { name: 'Open with default app' })
      await open.click()
      const dialog = page.getByRole('alertdialog')
      await expect(dialog).toContainText('Open "run.bat"?')
      await dialog.getByRole('button', { name: 'Cancel' }).click()
      await expect(dialog).toHaveCount(0)
      await open.click()
      await expect(dialog).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(dialog).toHaveCount(0)
      expect((await shellCalls()).openPath).toEqual([memo])

      // 确认后才打开
      await open.click()
      await dialog.getByRole('button', { name: 'Open', exact: true }).click()
      await expect(dialog).toHaveCount(0)
      await expect.poll(async () => (await shellCalls()).openPath).toEqual([memo, bat])

      // 没有 PCH_E2E_CRASH_PLUGIN 时测试插件不注册：.crash 由 fallback 显示
      await tree.getByRole('treeitem', { name: 'boom.crash' }).dblclick()
      await expect(panel(page).getByRole('heading', { name: 'boom.crash' })).toBeVisible()
      await expect(panel(page).getByRole('alert')).toHaveCount(0)
    } finally {
      await app.close()
    }
  })

  test('only plugin actions make a preview tab permanent; clicks, wheel and keys do not', async () => {
    const { app, page } = await launchFast(userData)
    try {
      await stubShell(app)
      const tree = await setup(page)
      await tree.getByRole('treeitem', { name: 'memo.txt' }).click()
      const memo = tab(page, 'memo.txt')
      await expect(memo).toHaveCSS('font-style', 'italic')

      // 点击内容、滚轮、在内容中按键：仍是预览标签
      const heading = panel(page).getByRole('heading', { name: 'memo.txt' })
      await heading.click()
      await heading.hover()
      await page.mouse.wheel(0, 300)
      await panel(page).getByRole('button', { name: 'Copy path' }).focus()
      await page.keyboard.press('ArrowDown')
      await page.keyboard.press('Shift')
      await expect(memo).toHaveCSS('font-style', 'italic')

      // 插件的动作（宿主调用）转常驻
      await panel(page).getByRole('button', { name: 'Copy path' }).click()
      await expect(memo).toHaveCSS('font-style', 'normal')
      // 之后的单击另开预览标签
      await tree.getByRole('treeitem', { name: 'run.bat' }).click()
      await expect(page.getByRole('tablist').getByRole('tab')).toHaveText(['memo.txt', 'run.bat'])
      await expect(tab(page, 'run.bat')).toHaveCSS('font-style', 'italic')
    } finally {
      await app.close()
    }
  })

  test('a crashing plugin only shows an error panel in its own tab', async () => {
    const { app, page } = await launchFast(userData, { PCH_E2E_CRASH_PLUGIN: '1' })
    try {
      await stubShell(app)
      const tree = await setup(page)
      const errorTitle = "This preview can't be displayed"

      // 渲染时抛错
      await tree.getByRole('treeitem', { name: 'boom.crash' }).dblclick()
      await expect(panel(page).getByRole('alert')).toContainText(errorTitle)
      await expect(panel(page).getByRole('alert')).toContainText('E2E crash')

      // 其他标签照常显示；外壳（树、标签栏）不受影响
      await tree.getByRole('treeitem', { name: 'memo.txt' }).dblclick()
      await expect(panel(page).getByRole('heading', { name: 'memo.txt' })).toBeVisible()
      await expect(panel(page).getByRole('alert')).toHaveCount(0)
      await expect(tree).toBeVisible()

      // 回到崩溃的标签：错误面板，可改为以文件信息显示
      await tab(page, 'boom.crash').click()
      await expect(panel(page).getByRole('alert')).toContainText(errorTitle)
      await panel(page).getByRole('button', { name: 'Show file info' }).click()
      await expect(panel(page).getByRole('heading', { name: 'boom.crash' })).toBeVisible()
      await expect(panel(page).getByRole('button', { name: 'Open with default app' })).toBeVisible()

      // 懒加载失败
      await tree.getByRole('treeitem', { name: 'bad.crashload' }).dblclick()
      await expect(panel(page).getByRole('alert')).toContainText(errorTitle)
      await expect(page.getByRole('tablist').getByRole('tab')).toHaveText([
        'boom.crash',
        'bad.crashload',
        'memo.txt'
      ])
    } finally {
      await app.close()
    }
  })
})
