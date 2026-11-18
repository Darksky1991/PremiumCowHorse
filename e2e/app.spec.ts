import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import { data, invoke, launch, retryLabel, snapshotTree, type Named } from './support'

test.describe('first screen', () => {
  let userData: string

  test.beforeEach(() => {
    userData = mkdtempSync(path.join(tmpdir(), 'pch-e2e-'))
  })
  test.afterEach(() => {
    rmSync(userData, { recursive: true, force: true })
  })

  test('boots from app:// and renders the shell', async () => {
    const { app, page } = await launch(userData)
    try {
      expect(page.url()).toBe('app://renderer/')
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
      await expect(page.getByRole('banner')).toContainText('PremiumCowHorse')
      await expect(page.getByRole('contentinfo')).toContainText('v0.1.0')
      // 外壳布局必须撑满窗口：状态栏贴着视口底部
      const layout = await page.evaluate(() => ({
        footerBottom: document.querySelector('footer')!.getBoundingClientRect().bottom,
        viewport: window.innerHeight
      }))
      expect(layout.footerBottom).toBe(layout.viewport)
      await page.screenshot({ path: 'test-results/first-screen.png' })
    } finally {
      await app.close()
    }
  })

  test('renderer is sandboxed and only sees the whitelisted bridge', async () => {
    const { app, page } = await launch(userData)
    try {
      const surface = await page.evaluate(() => ({
        bridge: Object.keys(window.pch ?? {}).sort(),
        hasRequire: typeof (window as { require?: unknown }).require !== 'undefined',
        hasProcess: typeof (window as { process?: unknown }).process !== 'undefined'
      }))
      expect(surface).toEqual({
        bridge: ['bootstrap', 'getPathForFile', 'invoke', 'on'],
        hasRequire: false,
        hasProcess: false
      })

      // 首帧防闪烁依赖 bootstrap：sandbox preload 中解码失败会静默变成 null
      const bootstrap = await page.evaluate(() => window.pch!.bootstrap)
      expect(bootstrap).toMatchObject({
        platform: process.platform,
        theme: expect.stringMatching(/^(light|dark)$/)
      })
      expect(bootstrap?.windowId).toMatch(/^[0-9a-f-]{36}$/)

      const results = await page.evaluate(async () => ({
        unknown: await window.pch!.invoke('fs.deleteEverything', {}),
        badInput: await window.pch!.invoke('settings.set', { 'appearance.themeMode': 'purple' })
      }))
      expect(results.unknown).toMatchObject({ ok: false, error: { code: 'IPC_UNKNOWN_CHANNEL' } })
      expect(results.badInput).toMatchObject({ ok: false, error: { code: 'IPC_BAD_INPUT' } })

      // CSP 不允许内联脚本
      const csp = await page
        .locator('meta[http-equiv="Content-Security-Policy"]')
        .getAttribute('content')
      expect(csp).toContain("script-src 'self';")
      expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/)
    } finally {
      await app.close()
    }
  })

  test('renderer errors are written to main.log', async () => {
    const { app, page } = await launch(userData)
    try {
      await page.evaluate(() => {
        // 模拟事件回调中未捕获的 Promise 异常
        void Promise.reject(new Error('e2e-unhandled-marker'))
      })
      const log = path.join(userData, 'logs', 'main.log')
      await expect
        .poll(() => (existsSync(log) ? readFileSync(log, 'utf8') : ''), { timeout: 5000 })
        .toContain('e2e-unhandled-marker')
    } finally {
      await app.close()
    }
  })

  test('theme and language changes apply immediately and persist across restarts', async () => {
    let { app, page } = await launch(userData)
    try {
      await page.getByRole('button', { name: /テーマ|主题|Theme/ }).click()
      await page.getByRole('menuitemradio', { name: /ダーク|深色|Dark/ }).click()
      await expect(page.locator('html')).toHaveClass(/dark/)
      // Base UI 的单选菜单项默认选中后不关闭菜单（closeOnClick=false），用 Esc 关闭
      await page.keyboard.press('Escape')

      await page.getByRole('button', { name: /言語|语言|Language/ }).click()
      await page.getByRole('menuitemradio', { name: 'English' }).click()
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Default')
      await expect(page.locator('html')).toHaveAttribute('lang', 'en')
    } finally {
      await app.close()
    }

    ;({ app, page } = await launch(userData))
    try {
      await expect(page.locator('html')).toHaveClass(/dark/)
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Default')
      expect(
        await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.getTitle())
      ).toBe('PremiumCowHorse')
      await page.screenshot({ path: 'test-results/first-screen-dark-en.png' })
    } finally {
      await app.close()
    }
  })

  test('Ctrl+B and the activity bar toggle the sidebar', async () => {
    const { app, page } = await launch(userData)
    try {
      const sidebar = page.locator('aside')
      await expect(sidebar).toBeVisible()
      await page.keyboard.press('Control+B')
      await expect(sidebar).toBeHidden()
      await page.getByRole('button', { name: /エクスプローラー|资源管理器|Explorer/ }).click()
      await expect(sidebar).toBeVisible()
    } finally {
      await app.close()
    }
  })

  test('custom window controls replace the native ones and work', async () => {
    const { app, page } = await launch(userData)
    const win = <T>(fn: (w: Electron.BrowserWindow) => T): Promise<T> =>
      app.evaluate(({ BrowserWindow }, f) => {
        const w = BrowserWindow.getAllWindows()[0]!
        return new Function('w', `return (${f})(w)`)(w)
      }, fn.toString())
    try {
      // 不使用 Window Controls Overlay，系统不再绘制原生按钮
      expect(await page.evaluate(() => navigator.windowControlsOverlay?.visible ?? false)).toBe(
        false
      )

      const maximize = page.getByRole('button', { name: /^(最大化|Maximize)$/ })
      await maximize.click()
      await expect.poll(() => win((w) => w.isMaximized())).toBe(true)
      const restore = page.getByRole('button', { name: /^(元に戻す|还原|Restore)$/ })
      await expect(restore).toBeVisible()
      await restore.click()
      await expect.poll(() => win((w) => w.isMaximized())).toBe(false)

      await page.getByRole('button', { name: /^(最小化|Minimize)$/ }).click()
      await expect.poll(() => win((w) => w.isMinimized())).toBe(true)
      await win((w) => w.restore())

      const closed = app.waitForEvent('close')
      await page.getByRole('button', { name: /^(閉じる|关闭|Close)$/ }).click()
      await closed
    } finally {
      await app.close().catch(() => undefined)
    }
  })
})

test.describe('workspace data layer over IPC', () => {
  let userData: string
  let files: string

  test.beforeEach(() => {
    userData = mkdtempSync(path.join(tmpdir(), 'pch-e2e-'))
    files = mkdtempSync(path.join(tmpdir(), 'pch-e2e-files-'))
    mkdirSync(path.join(files, '設計書'))
    writeFileSync(path.join(files, '設計書', '仕様.xlsx'), '')
  })
  test.afterEach(() => {
    rmSync(userData, { recursive: true, force: true })
    rmSync(files, { recursive: true, force: true })
  })

  test('creates and activates a workspace, adds a folder entry, lists it and persists', async () => {
    let { app, page } = await launch(userData)
    let workspaceId: string
    try {
      const initial = await data<Named[]>(page, 'workspace.list')
      expect(initial.map((w) => w.id)).toEqual(['default'])

      const created = await data(page, 'workspace.create', { name: '案件A' })
      workspaceId = created.id
      await data(page, 'workspace.activate', { id: workspaceId })
      expect((await data(page, 'workspace.active')).name).toBe('案件A')

      const folder = path.join(files, '設計書')
      const entry = await data(page, 'entry.add', {
        kind: 'folder',
        workspaceId,
        parentId: null,
        path: folder
      })
      expect(entry).toMatchObject({ kind: 'folder', label: '設計書' })
      const entries = await data<Named[]>(page, 'entry.list', { workspaceId })
      expect(entries.map((e) => e.id)).toEqual([entry.id])

      const listed = await data<{ items: Named[]; state: string }>(page, 'vfs.list', {
        uri: entry.uri,
        requestId: 'e2e-1'
      })
      expect(listed.items.map((f) => f.name)).toEqual(['仕様.xlsx'])
      // 首次列出：没有缓存，扫描进程枚举后返回
      expect(listed.state).toBe('fresh')

      const missing = await invoke(page, 'entry.add', {
        kind: 'folder',
        workspaceId,
        parentId: null,
        path: path.join(files, 'nope')
      })
      expect(missing).toMatchObject({ ok: false, error: { code: 'FS_NOT_FOUND' } })
    } finally {
      await app.close()
    }

    // 重启后：工作区、当前工作区与条目都还在
    ;({ app, page } = await launch(userData))
    try {
      expect((await data(page, 'workspace.active')).id).toBe(workspaceId)
      const entries = await data<Named[]>(page, 'entry.list', { workspaceId })
      expect(entries.map((e) => e.label)).toEqual(['設計書'])
    } finally {
      await app.close()
    }
  })

  test('explorer tree lists a folder entry lazily and supports keyboard expand / collapse', async () => {
    const { app, page } = await launch(userData)
    try {
      const { id: workspaceId } = await data(page, 'workspace.active')
      await data(page, 'entry.add', { kind: 'folder', workspaceId, parentId: null, path: files })

      const tree = page.getByRole('tree')
      const root = tree.getByRole('treeitem', { name: path.basename(files) })
      await expect(root).toHaveAttribute('aria-expanded', 'false')
      await expect(root).toHaveAttribute('aria-level', '1')

      // 点击可展开的行：选中并展开，真实子项懒加载
      await root.click()
      await expect(root).toHaveAttribute('aria-expanded', 'true')
      await expect(root).toHaveAttribute('aria-selected', 'true')
      const dir = tree.getByRole('treeitem', { name: '設計書' })
      await expect(dir).toHaveAttribute('aria-level', '2')

      // 键盘：↓ 选中子目录，→ 展开，← 折叠
      await page.keyboard.press('ArrowDown')
      await expect(dir).toHaveAttribute('aria-selected', 'true')
      await page.keyboard.press('ArrowRight')
      const file = tree.getByRole('treeitem', { name: '仕様.xlsx' })
      await expect(file).toHaveAttribute('aria-level', '3')
      await page.keyboard.press('ArrowLeft')
      await expect(file).toBeHidden()
      await expect(dir).toHaveAttribute('aria-expanded', 'false')
    } finally {
      await app.close()
    }
  })

  test('explorer tree shows an error row with retry for a folder that cannot be listed', async () => {
    const { app, page } = await launch(userData)
    try {
      const { id: workspaceId } = await data(page, 'workspace.active')
      const folder = path.join(files, '設計書')
      await data(page, 'entry.add', { kind: 'folder', workspaceId, parentId: null, path: folder })
      const root = page.getByRole('tree').getByRole('treeitem', { name: '設計書' })
      await expect(root).toBeVisible()

      // 添加后目录被移走：展开时列目录失败
      rmSync(folder, { recursive: true, force: true })
      await root.click()
      const retry = page.getByRole('button', { name: /^(再試行|重试|Retry)$/ })
      await expect(retry).toBeVisible()

      // 目录恢复后「重试」重新列出
      mkdirSync(folder)
      writeFileSync(path.join(folder, '復旧.txt'), '')
      await retry.click()
      await expect(page.getByRole('treeitem', { name: '復旧.txt' })).toBeVisible()
      await expect(retry).toBeHidden()
    } finally {
      await app.close()
    }
  })

  test('keyboard retry on the error row restores the listing and keeps the selection', async () => {
    const { app, page } = await launch(userData)
    try {
      const { id: workspaceId } = await data(page, 'workspace.active')
      const folder = path.join(files, '設計書')
      await data(page, 'entry.add', { kind: 'folder', workspaceId, parentId: null, path: folder })
      const tree = page.getByRole('tree')
      const root = tree.getByRole('treeitem', { name: '設計書' })
      await expect(root).toBeVisible()

      rmSync(folder, { recursive: true, force: true })
      await root.click()
      const retry = page.getByRole('button', { name: /^(再試行|重试|Retry)$/ })
      await expect(retry).toBeVisible()

      // 树内只有一个 Tab 停靠点：Tab 不会停在「重试」按钮上
      await page.keyboard.press('Tab')
      await expect(retry).not.toBeFocused()

      // 即使焦点落在按钮上（如程序聚焦），Enter 也不会被树接管去折叠父目录
      await retry.focus()
      await page.keyboard.press('Enter')
      await expect(root).toHaveAttribute('aria-expanded', 'true')

      // 键盘路径：选中错误行后按 Enter 重试
      await tree.focus()
      await page.keyboard.press('ArrowDown')
      const errorRow = tree.getByRole('treeitem', { name: new RegExp(retryLabel) })
      await expect(errorRow).toHaveAttribute('aria-selected', 'true')
      mkdirSync(folder)
      writeFileSync(path.join(folder, '復旧.txt'), '')
      await page.keyboard.press('Enter')
      const restored = tree.getByRole('treeitem', { name: '復旧.txt' })
      await expect(restored).toBeVisible()
      await expect(root).toHaveAttribute('aria-expanded', 'true')

      // 错误行消失后选择回到所属目录，↓ 继续从那里移动（而不是跳回第 0 行）
      await expect(root).toHaveAttribute('aria-selected', 'true')
      await page.keyboard.press('ArrowDown')
      await expect(restored).toHaveAttribute('aria-selected', 'true')
    } finally {
      await app.close()
    }
  })

  test('dragging an entry before another reorders entries and leaves the disk untouched', async () => {
    const { app, page } = await launch(userData)
    try {
      const { id: workspaceId } = await data(page, 'workspace.active')
      const a = path.join(files, 'a.txt')
      const b = path.join(files, 'b.txt')
      writeFileSync(a, '')
      writeFileSync(b, '')
      await data(page, 'entry.add', { kind: 'file', workspaceId, parentId: null, path: a })
      await data(page, 'entry.add', { kind: 'file', workspaceId, parentId: null, path: b })
      const labels = async (): Promise<string[]> =>
        (await data<Named[]>(page, 'entry.list', { workspaceId })).map((e) => e.label)
      await expect(page.getByRole('tree').getByRole('treeitem')).toHaveCount(2)
      expect(await labels()).toEqual(['a.txt', 'b.txt'])
      // 递归快照（路径 + 类型 + 大小 + mtime）：拖放前后完全一致（Review Focus 1）
      const before = snapshotTree(files)

      // 合成原生拖放事件：b 拖到 a 行的上缘（before）。dragover 已 preventDefault 才会触发 drop
      const result = await page.evaluate(() => {
        const rows = [...document.querySelectorAll<HTMLElement>('[role="treeitem"]')]
        const rowA = rows.find((r) => r.textContent === 'a.txt')!
        const rowB = rows.find((r) => r.textContent === 'b.txt')!
        const dt = new DataTransfer()
        const fire = (el: HTMLElement, type: string, clientY: number): DragEvent => {
          const rect = el.getBoundingClientRect()
          const ev = new DragEvent(type, {
            bubbles: true,
            cancelable: true,
            dataTransfer: dt,
            clientX: rect.left + 10,
            clientY
          })
          el.dispatchEvent(ev)
          return ev
        }
        fire(rowB, 'dragstart', rowB.getBoundingClientRect().top + 5)
        const over = fire(rowA, 'dragover', rowA.getBoundingClientRect().top + 2)
        fire(rowA, 'drop', rowA.getBoundingClientRect().top + 2)
        fire(rowB, 'dragend', 0)
        return { types: [...dt.types], overPrevented: over.defaultPrevented }
      })
      // 只携带自定义 MIME，没有 text/uri-list、text/plain、DownloadURL
      expect(result.types).toEqual(['application/x-pch-node'])
      expect(result.overPrevented).toBe(true)

      await expect.poll(labels).toEqual(['b.txt', 'a.txt'])
      expect(snapshotTree(files)).toEqual(before)
    } finally {
      await app.close()
    }
  })

  test('context menu: rename an entry from the tree', async () => {
    const { app, page } = await launch(userData)
    try {
      const { id: workspaceId } = await data(page, 'workspace.active')
      const a = path.join(files, 'a.txt')
      writeFileSync(a, '')
      await data(page, 'entry.add', { kind: 'file', workspaceId, parentId: null, path: a })
      const tree = page.getByRole('tree')
      await tree.getByRole('treeitem', { name: 'a.txt' }).click({ button: 'right' })
      await page.getByRole('menuitem', { name: renameLabel }).click()
      const input = page.getByRole('dialog').getByRole('textbox')
      await expect(input).toHaveValue('a.txt')
      // 预填的名称全选，直接输入即可替换
      await expect(input).toBeFocused()
      expect(
        await input.evaluate((el: HTMLInputElement) => [el.selectionStart, el.selectionEnd])
      ).toEqual([0, 5])
      await input.fill('renamed.txt')
      await page.keyboard.press('Enter')
      await expect(tree.getByRole('treeitem', { name: 'renamed.txt' })).toBeVisible()
      await expect(tree.getByRole('treeitem', { name: 'a.txt' })).toHaveCount(0)
      // 重命名只改条目标签，磁盘文件名不变
      expect(existsSync(a)).toBe(true)
    } finally {
      await app.close()
    }
  })

  test('context menu: removing an entry keeps the file on disk', async () => {
    const { app, page } = await launch(userData)
    try {
      const { id: workspaceId } = await data(page, 'workspace.active')
      const a = path.join(files, 'a.txt')
      writeFileSync(a, '')
      await data(page, 'entry.add', { kind: 'file', workspaceId, parentId: null, path: a })
      const tree = page.getByRole('tree')
      await tree.getByRole('treeitem', { name: 'a.txt' }).click({ button: 'right' })
      await page.getByRole('menuitem', { name: removeLabel }).click()
      const dialog = page.getByRole('alertdialog')
      // 文案明确「只移除条目，不会删除磁盘上的文件」
      await expect(dialog).toContainText(removeHint)
      await dialog.getByRole('button', { name: removeLabel }).click()
      await expect(tree.getByRole('treeitem', { name: 'a.txt' })).toHaveCount(0)
      expect(await data<unknown[]>(page, 'entry.list', { workspaceId })).toHaveLength(0)
      expect(existsSync(a)).toBe(true)
    } finally {
      await app.close()
    }
  })

  test('context menu: copy path of a real child writes its local path to the clipboard', async () => {
    const { app, page } = await launch(userData)
    try {
      const { id: workspaceId } = await data(page, 'workspace.active')
      await data(page, 'entry.add', { kind: 'folder', workspaceId, parentId: null, path: files })
      const tree = page.getByRole('tree')
      await tree.getByRole('treeitem', { name: path.basename(files) }).click()
      await tree.getByRole('treeitem', { name: '設計書' }).click({ button: 'right' })
      await page.getByRole('menuitem', { name: copyPathLabel }).click()
      await expect
        .poll(() => app.evaluate(({ clipboard }) => clipboard.readText()))
        .toBe(path.join(files, '設計書'))
    } finally {
      await app.close()
    }
  })

  test('context menu: focus returns to the tree, F2 / Delete work and status rows have no menu', async () => {
    const { app, page } = await launch(userData)
    try {
      const { id: workspaceId } = await data(page, 'workspace.active')
      const empty = path.join(files, '空')
      mkdirSync(empty)
      const a = path.join(files, 'a.txt')
      writeFileSync(a, '')
      await data(page, 'entry.add', { kind: 'folder', workspaceId, parentId: null, path: empty })
      await data(page, 'entry.add', { kind: 'file', workspaceId, parentId: null, path: a })
      const tree = page.getByRole('tree')

      // 状态行（空目录的「項目はありません」）没有右键菜单
      await tree.getByRole('treeitem', { name: '空' }).click()
      const status = tree.getByRole('treeitem', { name: /^(項目はありません|没有项目|No items)$/ })
      await expect(status).toBeVisible()
      await status.click({ button: 'right' })
      await expect(page.getByRole('menu')).toHaveCount(0)

      // 右键选中节点；Esc 关闭菜单后焦点回到树
      const row = tree.getByRole('treeitem', { name: 'a.txt' })
      await row.click({ button: 'right' })
      await expect(page.getByRole('menu')).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(tree).toBeFocused()
      await expect(row).toHaveAttribute('aria-selected', 'true')

      // F2 重命名、Delete 移除（Esc 取消后焦点仍回到树）
      await page.keyboard.press('F2')
      await expect(page.getByRole('dialog').getByRole('textbox')).toHaveValue('a.txt')
      await page.keyboard.press('Escape')
      await expect(tree).toBeFocused()
      await page.keyboard.press('Delete')
      await expect(page.getByRole('alertdialog')).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(tree).toBeFocused()
      expect(await data<unknown[]>(page, 'entry.list', { workspaceId })).toHaveLength(2)
    } finally {
      await app.close()
    }
  })

  test('context menu: new group from the blank area creates a root group', async () => {
    const { app, page } = await launch(userData)
    try {
      const { id: workspaceId } = await data(page, 'workspace.active')
      const a = path.join(files, 'a.txt')
      writeFileSync(a, '')
      await data(page, 'entry.add', { kind: 'file', workspaceId, parentId: null, path: a })
      const tree = page.getByRole('tree')
      await expect(tree.getByRole('treeitem', { name: 'a.txt' })).toBeVisible()
      await tree.click({ button: 'right', position: { x: 40, y: 300 } })
      await page.getByRole('menuitem', { name: newGroupLabel }).click()
      const input = page.getByRole('dialog').getByRole('textbox')
      await expect(input).toHaveValue(newGroupDefault)
      await input.fill('案件A')
      await page.keyboard.press('Enter')
      await expect(tree.getByRole('treeitem', { name: '案件A' })).toBeVisible()
      const entries = await data<Array<Named & { kind: string; parentId: string | null }>>(
        page,
        'entry.list',
        { workspaceId }
      )
      expect(entries.find((e) => e.label === '案件A')).toMatchObject({
        kind: 'group',
        parentId: null
      })
    } finally {
      await app.close()
    }
  })

  test('context menu: the empty workspace offers a new group button', async () => {
    const { app, page } = await launch(userData)
    try {
      const { id: workspaceId } = await data(page, 'workspace.active')
      await page.getByRole('button', { name: newGroupLabel }).click()
      const input = page.getByRole('dialog').getByRole('textbox')
      await expect(input).toHaveValue(newGroupDefault)
      await input.fill('案件A')
      await page.keyboard.press('Enter')
      await expect(page.getByRole('tree').getByRole('treeitem', { name: '案件A' })).toBeVisible()
      expect(await data<Named[]>(page, 'entry.list', { workspaceId })).toHaveLength(1)
    } finally {
      await app.close()
    }
  })

  test('empty state: adding several folders keeps going after one of them fails', async () => {
    const { app, page } = await launch(userData)
    try {
      const { id: workspaceId } = await data(page, 'workspace.active')
      const missing = path.join(files, '存在しない')
      const good = path.join(files, '設計書')
      const good2 = path.join(files, '議事録')
      mkdirSync(good2)
      // 系统对话框无法自动化：在主进程中替换 showOpenDialog 的结果（选中的第一项不存在）。
      // 第二项添加后空状态被树取代（组件卸载），第三项也必须照常添加
      await app.evaluate(
        ({ dialog }, filePaths) => {
          Object.assign(dialog, { showOpenDialog: async () => ({ canceled: false, filePaths }) })
        },
        [missing, good, good2]
      )
      await page.getByRole('button', { name: addFolderLabel }).click()
      // 第一项失败（提示错误）后继续添加其余项，与树空白处菜单的「添加文件夹…」一致
      await expect(page.getByRole('tree').getByRole('treeitem', { name: '議事録' })).toBeVisible()
      await expect(page.getByText(notFoundText)).toBeVisible()
      expect(
        (await data<Named[]>(page, 'entry.list', { workspaceId })).map((e) => e.label)
      ).toEqual(['設計書', '議事録'])
    } finally {
      await app.close()
    }
  })

  test('context menu: dialogs close when the entry was removed in the meantime', async () => {
    const { app, page } = await launch(userData)
    try {
      const { id: workspaceId } = await data(page, 'workspace.active')
      const a = path.join(files, 'a.txt')
      const b = path.join(files, 'b.txt')
      writeFileSync(a, '')
      writeFileSync(b, '')
      const entryA = await data(page, 'entry.add', {
        kind: 'file',
        workspaceId,
        parentId: null,
        path: a
      })
      await data(page, 'entry.add', { kind: 'file', workspaceId, parentId: null, path: b })
      const tree = page.getByRole('tree')
      await expect(tree.getByRole('treeitem')).toHaveCount(2)
      await tree.getByRole('treeitem', { name: 'a.txt' }).click()

      // 重命名：对话框打开期间条目被删除 → 提交后对话框关闭（并有错误提示）
      await page.keyboard.press('F2')
      const input = page.getByRole('dialog').getByRole('textbox')
      await expect(input).toBeFocused()
      await data(page, 'entry.remove', { id: entryA.id })
      await expect(tree.getByRole('treeitem', { name: 'a.txt' })).toHaveCount(0)
      await input.fill('x.txt')
      await page.keyboard.press('Enter')
      await expect(page.getByRole('dialog')).toHaveCount(0)

      // 移除：目标已达成 → 静默关闭，不弹错误
      await tree.getByRole('treeitem', { name: 'b.txt' }).click()
      const entryB = (await data<Named[]>(page, 'entry.list', { workspaceId }))[0]
      await page.keyboard.press('Delete')
      const alert = page.getByRole('alertdialog')
      await expect(alert).toBeVisible()
      await data(page, 'entry.add', { kind: 'file', workspaceId, parentId: null, path: a })
      await data(page, 'entry.remove', { id: entryB.id })
      await alert.getByRole('button', { name: removeLabel }).click()
      await expect(alert).toHaveCount(0)
      await expect(page.locator('[data-sonner-toast][data-type="error"]')).toHaveCount(0)
    } finally {
      await app.close()
    }
  })

  test('workspace switcher: create, switch, rename, restore default name and delete', async () => {
    const { app, page } = await launch(userData)
    try {
      const { id: defaultId } = await data(page, 'workspace.active')
      const a = path.join(files, 'a.txt')
      writeFileSync(a, '')
      await data(page, 'entry.add', {
        kind: 'file',
        workspaceId: defaultId,
        parentId: null,
        path: a
      })
      const tree = page.getByRole('tree')
      const switcher = page.getByRole('banner').getByRole('button', { name: workspaceTrigger })
      const heading = page.getByRole('heading', { level: 1 })
      // 上一个菜单的关闭动画（data-ending-style）结束前再次点击切换器，菜单会重新打开但焦点留在按钮上，
      // 随后的 Esc / 点击不按预期生效（e2e 偶发失败的原因）：每次打开前等旧菜单从 DOM 中移除
      const openMenu = async (): Promise<void> => {
        await expect(page.getByRole('menu')).toHaveCount(0)
        await switcher.click()
        await expect(page.getByRole('menu')).toBeVisible()
      }
      const menuOf = async (name: RegExp): Promise<void> => {
        await openMenu()
        await page.getByRole('menuitem', { name }).click()
      }
      await expect(switcher).toHaveText(defaultName)
      await expect(tree.getByRole('treeitem', { name: 'a.txt' })).toBeVisible()

      // 新建：自动切换到新工作区，标题栏、欢迎页同时更新，树换成新工作区的（空）内容
      await menuOf(newWorkspaceLabel)
      const input = page.getByRole('dialog').getByRole('textbox')
      await input.fill('案件A')
      await page.keyboard.press('Enter')
      await expect(switcher).toHaveText('案件A')
      await expect(heading).toHaveText('案件A')
      await expect(tree.getByRole('treeitem')).toHaveCount(0)
      // 对话框关闭后焦点回到切换器按钮，而不是落到 body
      await expect(switcher).toBeFocused()
      expect((await data(page, 'workspace.active')).name).toBe('案件A')

      // 切回默认工作区：树恢复为默认工作区的条目
      await openMenu()
      await page.getByRole('menuitemradio', { name: defaultName }).click()
      await expect(switcher).toHaveText(defaultName)
      await expect(heading).toHaveText(defaultName)
      await expect(tree.getByRole('treeitem', { name: 'a.txt' })).toBeVisible()

      // 默认工作区不能删除，也没有「恢复默认名称」（菜单已打开后再断言「不存在」，避免空洞通过）
      await openMenu()
      await expect(page.getByRole('menuitem', { name: newWorkspaceLabel })).toBeVisible()
      await expect(page.getByRole('menuitem', { name: deleteWorkspaceLabel })).toHaveCount(0)
      await expect(page.getByRole('menuitem', { name: restoreNameLabel })).toHaveCount(0)
      await page.keyboard.press('Escape')

      // 重命名默认工作区，再恢复默认名称
      await menuOf(renameWorkspaceLabel)
      await expect(page.getByRole('dialog').getByRole('textbox')).toHaveValue(defaultName)
      await page.getByRole('dialog').getByRole('textbox').fill('共用')
      await page.keyboard.press('Enter')
      await expect(switcher).toHaveText('共用')
      await expect(heading).toHaveText('共用')
      await expect(switcher).toBeFocused()
      await menuOf(restoreNameLabel)
      await expect(switcher).toHaveText(defaultName)
      expect((await data(page, 'workspace.active')).name).toBe('')

      // 删除当前工作区：只删工作区与条目，之后回到默认工作区
      await openMenu()
      await page.getByRole('menuitemradio', { name: '案件A' }).click()
      await expect(switcher).toHaveText('案件A')
      await menuOf(deleteWorkspaceLabel)
      const alert = page.getByRole('alertdialog')
      await expect(alert).toContainText(removeHint)
      await alert.getByRole('button', { name: deleteConfirmLabel }).click()
      await expect(alert).toHaveCount(0)
      await expect(switcher).toHaveText(defaultName)
      await expect(heading).toHaveText(defaultName)
      // 删除成功（触发项所在的工作区已不存在）后焦点也回到切换器按钮
      await expect(switcher).toBeFocused()
      await expect(tree.getByRole('treeitem', { name: 'a.txt' })).toBeVisible()
      expect((await data(page, 'workspace.active')).id).toBe(defaultId)
      expect((await data<Named[]>(page, 'workspace.list')).map((w) => w.id)).toEqual([defaultId])
      expect(existsSync(a)).toBe(true)

      // 欢迎页的「新建工作区」打开同一个对话框
      await page.getByRole('main').getByRole('button', { name: newWorkspaceWelcome }).click()
      await expect(page.getByRole('dialog').getByRole('textbox')).toBeVisible()
    } finally {
      await app.close()
    }
  })

  test('workspace switcher: rename / delete dialogs act on the workspace they were opened for', async () => {
    const { app, page } = await launch(userData)
    try {
      const { id: defaultId } = await data(page, 'workspace.active')
      const a = await data(page, 'workspace.create', { name: '案件A' })
      const b = await data(page, 'workspace.create', { name: '案件B' })
      await data(page, 'workspace.activate', { id: a.id })
      const switcher = page.getByRole('banner').getByRole('button', { name: workspaceTrigger })
      await expect(switcher).toHaveText('案件A')
      const openMenuItem = async (name: RegExp): Promise<void> => {
        await expect(page.getByRole('menu')).toHaveCount(0)
        await switcher.click()
        await expect(page.getByRole('menu')).toBeVisible()
        await page.getByRole('menuitem', { name }).click()
      }
      // 对话框打开期间页面其余部分是 inert（aria-hidden），用 includeHidden 读取标题栏的当前工作区
      const switcherBehindDialog = page
        .getByRole('banner', { includeHidden: true })
        .getByRole('button', { name: workspaceTrigger, includeHidden: true })
      const names = async (): Promise<string[]> =>
        (await data<Named[]>(page, 'workspace.list')).map((w) => w.name).sort()

      // 重命名对话框打开期间当前工作区变了（例如另一个窗口切换）：仍然重命名打开时的工作区
      await openMenuItem(renameWorkspaceLabel)
      const input = page.getByRole('dialog').getByRole('textbox')
      await expect(input).toHaveValue('案件A')
      await data(page, 'workspace.activate', { id: b.id })
      await expect(switcherBehindDialog).toHaveText('案件B')
      await input.fill('案件A2')
      await page.keyboard.press('Enter')
      await expect(page.getByRole('dialog')).toHaveCount(0)
      expect(await names()).toEqual(['', '案件A2', '案件B'])

      // 删除确认框同样锁定打开时的工作区
      await data(page, 'workspace.activate', { id: a.id })
      await expect(switcher).toHaveText('案件A2')
      await openMenuItem(deleteWorkspaceLabel)
      const alert = page.getByRole('alertdialog')
      await expect(alert).toContainText('案件A2')
      await data(page, 'workspace.activate', { id: b.id })
      await expect(switcherBehindDialog).toHaveText('案件B')
      await alert.getByRole('button', { name: deleteConfirmLabel }).click()
      await expect(alert).toHaveCount(0)
      expect((await data<Named[]>(page, 'workspace.list')).map((w) => w.id).sort()).toEqual(
        [defaultId, b.id].sort()
      )
    } finally {
      await app.close()
    }
  })
})

/** 右键菜单与对话框的文案（ja | zh-CN | en；e2e 默认语言随系统，三种都匹配） */
const renameLabel = /^(名前の変更|重命名|Rename) ?(F2)?$/
const removeLabel = /^(ワークスペースから外す|从工作区移除|Remove from workspace) ?(Del)?$/
const removeHint =
  /(ディスク上のファイルやフォルダーは削除されません|不会删除磁盘上的文件或文件夹|does not delete any files or folders on disk)/
const copyPathLabel = /^(パスをコピー|复制路径|Copy path)$/
const newGroupLabel = /^(グループを新規作成|新建分组|New group)$/
const newGroupDefault = /^(新しいグループ|新建分组|New group)$/
const addFolderLabel = /^(フォルダーを追加|添加文件夹|Add folder)$/
/** errors:FS_NOT_FOUND 的文案（toast） */
const notFoundText =
  /(ファイルまたはフォルダーが見つかりません|找不到文件或文件夹|File or folder not found)/

/** 工作区切换器的文案 */
const defaultName = /^(デフォルト|默认|Default)$/
const workspaceTrigger = /^(ワークスペースの切り替え|切换工作区|Switch workspace)$/
const newWorkspaceLabel = /^(新しいワークスペース…|新建工作区…|New workspace…)$/
const newWorkspaceWelcome = /^(新しいワークスペースを作成|新建工作区|Create a workspace)$/
const renameWorkspaceLabel =
  /^(現在のワークスペースの名前を変更…|重命名当前工作区…|Rename current workspace…)$/
const restoreNameLabel = /^(既定の名前に戻す|恢复默认名称|Restore default name)$/
const deleteWorkspaceLabel =
  /^(現在のワークスペースを削除…|删除当前工作区…|Delete current workspace…)$/
const deleteConfirmLabel = /^(削除|删除|Delete)$/
