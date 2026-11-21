import {
  appendFileSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { data, launchFast, removeDirs, toggleRow } from './support'

/** text-engine 的编码样本（samples：原始字节；expected：UTF-8 原文） */
const FIXTURES = path.resolve(__dirname, '../packages/text-engine/fixtures')
/** 设置时把页面级截图（ja 浅色）写到这个目录（不设置时不截图） */
const SCREENSHOT_DIR = process.env['PCH_E2E_SCREENSHOT_DIR']

const LOG_LINES = 100_000
const logLine = (n: number): string => `L${n}: message ${n}`

/** 文本查看器（自绘分页视图）的各部分 */
const region = (page: Page): Locator => page.getByRole('region', { name: 'ファイルの内容' })
const line = (page: Page, n: number): Locator => region(page).locator(`[data-line="${n}"]`)
const gutter = (page: Page): Locator => region(page).locator('[data-gutter]')
const statusBar = (page: Page): Locator => page.locator('[data-status-bar]')
const lineCount = (page: Page): Locator => statusBar(page).locator('[data-lines]')
const followButton = (page: Page): Locator =>
  page.getByRole('toolbar').getByRole('button', { name: '末尾を追従' })
/** errors:FS_NOT_FOUND（ja） */
const NOT_FOUND = 'ファイルまたはフォルダーが見つかりません'

/** 第一行（可见行中行号最小者）的行号 */
async function firstVisibleLine(page: Page): Promise<number> {
  return Number(await gutter(page).first().getAttribute('data-gutter'))
}

test.describe('text and log viewer', () => {
  let userData: string
  let files: string
  let project: string

  test.beforeEach(() => {
    userData = mkdtempSync(path.join(tmpdir(), 'pch-e2e-'))
    files = mkdtempSync(path.join(tmpdir(), 'pch-e2e-text-'))
    project = path.join(files, 'logs')
    mkdirSync(project, { recursive: true })
  })
  test.afterEach(() => {
    removeDirs(userData, files)
  })

  /** 界面语言 ja、浅色；添加并展开条目 logs（箭头：不打开标签），返回树 */
  async function setup(page: Page, settings: Record<string, unknown> = {}): Promise<Locator> {
    await data(page, 'settings.set', {
      'general.language': 'ja',
      'appearance.themeMode': 'light',
      ...settings
    })
    await expect(page.locator('html')).toHaveAttribute('lang', 'ja')
    const { id: workspaceId } = await data(page, 'workspace.active')
    await data(page, 'entry.add', { kind: 'folder', workspaceId, parentId: null, path: project })
    const tree = page.getByRole('tree')
    await toggleRow(tree.getByRole('treeitem', { name: 'logs' }))
    return tree
  }

  test('a 100k-line log opens at its end; Ctrl+Home and dragging the scrollbar move by lines', async () => {
    const lines = Array.from({ length: LOG_LINES }, (_, i) => logLine(i + 1))
    writeFileSync(path.join(project, 'app.log'), `${lines.join('\n')}\n`)
    const { app, page } = await launchFast(userData)
    try {
      const tree = await setup(page)
      await tree.getByRole('treeitem', { name: 'app.log' }).dblclick()

      // 日志类：打开在末尾并跟随；最后一行与行号正确
      await expect(line(page, LOG_LINES)).toHaveText(logLine(LOG_LINES))
      await expect(gutter(page).last()).toHaveAttribute('data-gutter', String(LOG_LINES))
      await expect(lineCount(page)).toHaveText('100,000 行')
      await expect(followButton(page)).toHaveAttribute('aria-pressed', 'true')
      // 只渲染可见行
      expect(await region(page).locator('[data-line]').count()).toBeLessThan(100)

      if (SCREENSHOT_DIR) {
        await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'text-log-ja-light.png') })
      }

      // Ctrl+Home：开头（跟随关闭）
      await region(page).focus()
      await page.keyboard.press('Control+Home')
      await expect(line(page, 1)).toHaveText(logLine(1))
      await expect(gutter(page).first()).toHaveAttribute('data-gutter', '1')
      await expect(followButton(page)).toHaveAttribute('aria-pressed', 'false')
      // ↓ / PageDown
      await page.keyboard.press('ArrowDown')
      await expect(gutter(page).first()).toHaveAttribute('data-gutter', '2')
      await page.keyboard.press('PageDown')
      expect(await firstVisibleLine(page)).toBeGreaterThan(10)

      // 把滚动条的拇指拖到轨道中间：显示中间附近的行，行号与内容一致
      const track = page.getByRole('scrollbar')
      const thumb = track.locator('[data-thumb]')
      const t = (await track.boundingBox())!
      const b = (await thumb.boundingBox())!
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2)
      await page.mouse.down()
      await page.mouse.move(b.x + b.width / 2, t.y + t.height / 2, { steps: 8 })
      await page.mouse.up()
      await expect.poll(() => firstVisibleLine(page)).toBeGreaterThan(LOG_LINES * 0.4)
      const n = await firstVisibleLine(page)
      expect(n).toBeLessThan(LOG_LINES * 0.6)
      await expect(line(page, n)).toHaveText(logLine(n))
      await expect(line(page, n + 5)).toHaveText(logLine(n + 5))

      // 滚轮向下
      await region(page).hover()
      await page.mouse.wheel(0, 200)
      await expect.poll(() => firstVisibleLine(page)).toBeGreaterThan(n)
    } finally {
      await app.close()
    }
  })

  test('following shows appended lines; a rotated log reloads; a deleted file keeps its content', async () => {
    const log = path.join(project, 'app.log')
    writeFileSync(log, `${Array.from({ length: 10 }, (_, i) => logLine(i + 1)).join('\n')}\n`)
    const { app, page } = await launchFast(userData)
    try {
      const tree = await setup(page)
      await tree.getByRole('treeitem', { name: 'app.log' }).dblclick()
      await expect(line(page, 10)).toHaveText(logLine(10))
      await expect(followButton(page)).toHaveAttribute('aria-pressed', 'true')

      // 外部追加 3 行：宿主的自动检查（2 秒）→ appended → 跟随显示（不按 F5）
      appendFileSync(log, `${[11, 12, 13].map(logLine).join('\n')}\n`)
      await expect(line(page, 13)).toHaveText(logLine(13), { timeout: 15_000 })
      await expect(lineCount(page)).toHaveText('13 行')

      // 轮转：改名后新建同名文件 → reset → 显示新文件
      renameSync(log, path.join(project, 'app.log.1'))
      writeFileSync(log, 'rotated 1\nrotated 2\n')
      await expect(line(page, 2)).toHaveText('rotated 2', { timeout: 15_000 })
      await expect(lineCount(page)).toHaveText('2 行')
      await expect(line(page, 3)).toHaveCount(0)

      // 删除：「文件已不存在」，保留已显示的内容
      rmSync(log)
      await expect(
        page.getByRole('status').filter({ hasText: 'ファイルが存在しません' })
      ).toBeVisible({
        timeout: 15_000
      })
      await expect(line(page, 2)).toHaveText('rotated 2')

      // 同名文件重新出现：离开「文件已不存在」
      writeFileSync(log, 'back 1\n')
      await expect(line(page, 1)).toHaveText('back 1', { timeout: 15_000 })
      await expect(page.getByText('ファイルが存在しません')).toHaveCount(0)
    } finally {
      await app.close()
    }
  })

  test('renaming a ~200MB file while it is being indexed succeeds, and so does renaming its folder', async () => {
    const dir = path.join(project, 'big')
    mkdirSync(dir)
    const row = Buffer.from(`${'0123456789'.repeat(9)}abcdefgh\n`)
    const chunk = Buffer.concat(Array.from({ length: 10_000 }, () => row))
    const file = path.join(dir, 'data.log')
    // 约 200MB（本机的磁盘缓存下 50MB 的索引在状态栏显示「%」之前就可能完成，改名落在索引之后）
    writeFileSync(file, chunk)
    for (let i = 1; i < 200; i++) appendFileSync(file, chunk)
    const { app, page } = await launchFast(userData)
    try {
      // 全量模式（默认上限 50MB 以上为部分模式，只索引 4MB）
      const tree = await setup(page, { 'preview.maxTextSizeMB': 500 })
      await toggleRow(tree.getByRole('treeitem', { name: 'big' }))
      await tree.getByRole('treeitem', { name: 'data.log' }).dblclick()
      await expect(region(page)).toBeVisible()

      // 索引进行中（状态栏显示百分比）改名该文件本身：必须成功（读取时不独占、不长期持有句柄）
      await expect(lineCount(page)).toContainText('%')
      const renamed = path.join(dir, 'data-renamed.log')
      renameSync(file, renamed)
      // 改名确实发生在索引进行中：之后的一块读取找不到文件，状态栏显示索引失败（错误码对应的文案，不是错误码）
      await expect(statusBar(page)).toContainText(
        `読み込みに失敗しました（${NOT_FOUND}）。更新で再試行します`
      )
      await expect(lineCount(page)).toContainText('%')
      // 上级目录：没有读取进行时必须能改名（读取进行中 Windows 不允许改名上级目录，见 doc 7.1）
      const movedDir = path.join(project, 'big-moved')
      await renameWithin(dir, movedDir, 2000)

      // 放回原处：宿主的自动检查发现文件重新出现 → reset → 重新建索引直到完成
      renameSync(movedDir, dir)
      renameSync(renamed, file)
      await expect(lineCount(page)).toHaveText('2,000,000 行', { timeout: 30_000 })
      // 索引完成后：上级目录一次改名成功
      renameSync(dir, path.join(project, 'big-after'))
    } finally {
      await app.close()
    }
  })

  test('a read error goes away when the file comes back (reset), even with nothing to read', async () => {
    const log = path.join(project, 'app.log')
    writeFileSync(log, `${Array.from({ length: 10_000 }, (_, i) => logLine(i + 1)).join('\n')}\n`)
    const { app, page } = await launchFast(userData)
    try {
      const tree = await setup(page)
      await tree.getByRole('treeitem', { name: 'app.log' }).dblclick()
      await expect(line(page, 10_000)).toHaveText(logLine(10_000))

      // 删除后移到开头：开头的块没有缓存，读取失败 → 状态栏显示读取错误
      rmSync(log)
      await region(page).focus()
      await page.keyboard.press('Control+Home')
      await expect(statusBar(page)).toContainText(NOT_FOUND)

      // 同名的空文件出现：reset 之后没有要读的行，旧的读取错误也不再显示
      writeFileSync(log, '')
      await expect(page.getByText('空のファイルです')).toBeVisible({ timeout: 15_000 })
      await expect(statusBar(page)).not.toContainText(NOT_FOUND)
    } finally {
      await app.close()
    }
  })

  test('a position saved right before leaving is restored on back', async () => {
    writeFileSync(
      path.join(project, 'a.txt'),
      `${Array.from({ length: 1000 }, (_, i) => `A${i + 1}`).join('\n')}\n`
    )
    writeFileSync(path.join(project, 'b.txt'), 'B1\n')
    const { app, page } = await launchFast(userData)
    try {
      const tree = await setup(page)
      await tree.getByRole('treeitem', { name: 'a.txt' }).dblclick()
      await expect(line(page, 1)).toHaveText('A1')
      await region(page).focus()
      await page.keyboard.press('PageDown')
      await page.keyboard.press('PageDown')
      const n = await firstVisibleLine(page)
      expect(n).toBeGreaterThan(1)
      // 移动后立即（保存的防抖 150ms 之内）在同一标签打开另一个文件：卸载时补存位置
      await tree.getByRole('treeitem', { name: 'b.txt' }).dblclick()
      await expect(line(page, 1)).toHaveText('B1')
      await page.keyboard.press('Alt+ArrowLeft')
      await expect(line(page, n)).toHaveText(`A${n}`)
      expect(await firstVisibleLine(page)).toBe(n)
    } finally {
      await app.close()
    }
  })

  test('Shift_JIS / EUC-JP / GBK / Big5 / UTF-16 / ISO-2022-JP / Windows-1252 samples decode correctly; switching the encoding works', async () => {
    const samples = [
      { file: 'ja-sjis-paragraph.txt', name: 'Shift_JIS' },
      { file: 'ja-eucjp-paragraph.txt', name: 'EUC-JP' },
      { file: 'zh-gbk-paragraph.txt', name: 'GB18030 (GBK)' },
      { file: 'tw-big5-paragraph.txt', name: 'Big5' },
      { file: 'ja-utf16le-bom-paragraph.txt', name: 'UTF-16 LE' },
      { file: 'ja-utf16be-bom-paragraph.txt', name: 'UTF-16 BE' },
      { file: 'ja-jis-paragraph.txt', name: 'ISO-2022-JP' },
      { file: 'en-1252-paragraph.txt', name: 'Windows-1252' }
    ]
    for (const s of samples)
      copyFileSync(path.join(FIXTURES, 'samples', s.file), path.join(project, s.file))
    const expected = (file: string): string =>
      readFileSync(path.join(FIXTURES, 'expected', file), 'utf8')
        .replace(/^\uFEFF/, '')
        .split(/\r?\n/)[0]!
    const { app, page } = await launchFast(userData)
    try {
      const tree = await setup(page)
      const encodingButton = statusBar(page).getByRole('button', { name: /^文字コード:/ })
      for (const s of samples) {
        await tree.getByRole('treeitem', { name: s.file }).dblclick()
        await expect(line(page, 1)).toHaveText(expected(s.file))
        await expect(encodingButton).toHaveAccessibleName(`文字コード: ${s.name}`)
        await expect(statusBar(page)).not.toContainText('文字化け')
      }

      // 手动切换：Shift_JIS 的样本按 EUC-JP 解码 → 内容改变；回到「自動判別」→ 恢复
      const sjis = samples[0]!.file
      await tree.getByRole('treeitem', { name: sjis }).dblclick()
      await expect(line(page, 1)).toHaveText(expected(sjis))
      await encodingButton.click()
      await page.getByRole('menuitemradio', { name: 'EUC-JP' }).click()
      await expect(encodingButton).toHaveText(/^EUC-JP/)
      await expect(line(page, 1)).not.toHaveText(expected(sjis))
      await expect(statusBar(page)).toContainText('文字化けしている可能性があります')
      await encodingButton.click()
      await page.getByRole('menuitemradio', { name: '自動判別' }).click()
      await expect(encodingButton).toHaveText(/^Shift_JIS（自動）/)
      await expect(line(page, 1)).toHaveText(expected(sjis))
    } finally {
      await app.close()
    }
  })

  test('text without an extension opens as text; a binary file goes to file info and can be viewed as text', async () => {
    writeFileSync(
      path.join(project, 'messages'),
      'Nov 20 08:00:01 host sshd: one\nNov 20 08:00:02 host sshd: two\n'
    )
    const png = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44,
      0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00
    ])
    // PNG 的字节放在 .dat 中：.png 自 M2 Task 7 起由浏览器显示插件处理，这里只要「没有插件匹配的二进制」
    writeFileSync(path.join(project, 'image.dat'), png)
    const { app, page } = await launchFast(userData)
    try {
      const tree = await setup(page)
      // 无扩展名：容器 sniff 为文本 → 文本插件（日志类：在末尾并跟随）
      await tree.getByRole('treeitem', { name: 'messages' }).dblclick()
      await expect(line(page, 2)).toHaveText('Nov 20 08:00:02 host sshd: two')
      await expect(followButton(page)).toHaveAttribute('aria-pressed', 'true')

      // 二进制：兜底插件 →「テキストとして表示」→ 文本插件（提示按文本显示二进制）
      await tree.getByRole('treeitem', { name: 'image.dat' }).dblclick()
      const panel = page.getByRole('tabpanel')
      await expect(panel.getByRole('heading', { name: 'image.dat' })).toBeVisible()
      // 自动选择到兜底插件时显示「无法预览」
      await expect(panel).toContainText('この種類のファイルはプレビューできません。')
      await panel.getByRole('button', { name: 'テキストとして表示' }).click()
      await expect(region(page)).toBeVisible()
      await expect(region(page)).toContainText('IHDR')
      await expect(statusBar(page)).toContainText('バイナリファイルをテキストとして表示しています')
    } finally {
      await app.close()
    }
  })

  test('a ~20MB single line is cut off with a hint and the view stays usable', async () => {
    writeFileSync(path.join(project, 'oneline.txt'), Buffer.alloc(20 * 1024 * 1024, 'a'))
    const { app, page } = await launchFast(userData)
    try {
      const tree = await setup(page)
      await tree.getByRole('treeitem', { name: 'oneline.txt' }).dblclick()
      await expect(lineCount(page)).toHaveText('1 行', { timeout: 30_000 })
      await expect(line(page, 1)).toContainText('…（行が長すぎるため省略）')
      await expect(statusBar(page)).toContainText('長すぎる行は途中までしか表示していません')
      // 操作できる：跟随的切换、键盘、标签以外的界面
      await followButton(page).click()
      await expect(followButton(page)).toHaveAttribute('aria-pressed', 'true')
      await region(page).focus()
      await page.keyboard.press('ArrowRight')
      await page.keyboard.press('Control+Home')
      await expect(followButton(page)).toHaveAttribute('aria-pressed', 'false')
      await expect(line(page, 1)).toBeVisible()
    } finally {
      await app.close()
    }
  })

  test('above preview.maxTextSizeMB only a 4MB window is shown; Read all builds the full index', async () => {
    const lines = Array.from({ length: 120_000 }, (_, i) => `R${i + 1}: ${'-'.repeat(40)}`)
    writeFileSync(path.join(project, 'big.txt'), `${lines.join('\n')}\n`)
    const { app, page } = await launchFast(userData)
    try {
      const tree = await setup(page, { 'preview.maxTextSizeMB': 1 })
      await tree.getByRole('treeitem', { name: 'big.txt' }).dblclick()
      // 部分模式（.txt：开头的窗口）：不显示行号
      await expect(line(page, 1)).toHaveText(lines[0]!)
      await expect(statusBar(page)).toContainText('先頭 4 MB のみ表示')
      await expect(gutter(page)).toHaveCount(0)

      await statusBar(page).getByRole('button', { name: 'すべて読み込む' }).click()
      await expect(lineCount(page)).toHaveText('120,000 行', { timeout: 30_000 })
      await expect(statusBar(page)).not.toContainText('のみ表示')
      await expect(gutter(page).first()).toHaveAttribute('data-gutter', '1')
      await expect(line(page, 1)).toHaveText(lines[0]!)
      await region(page).focus()
      await page.keyboard.press('Control+End')
      await expect(line(page, 120_000)).toHaveText(lines[119_999]!)
    } finally {
      await app.close()
    }
  })

  test('Read all from the 4MB tail window of a log goes to the end of the whole file', async () => {
    const lines = Array.from({ length: 120_000 }, (_, i) => `T${i + 1}: ${'-'.repeat(40)}`)
    writeFileSync(path.join(project, 'big.log'), `${lines.join('\n')}\n`)
    const { app, page } = await launchFast(userData)
    try {
      const tree = await setup(page, { 'preview.maxTextSizeMB': 1 })
      await tree.getByRole('treeitem', { name: 'big.log' }).dblclick()
      await expect(statusBar(page)).toContainText('末尾 4 MB のみ表示')
      // 窗口内的开头（窗口内第 0 行，不是文件的第 1 行）；跟随关闭
      await region(page).focus()
      await page.keyboard.press('Control+Home')
      await expect(followButton(page)).toHaveAttribute('aria-pressed', 'false')
      await expect(line(page, 1)).not.toHaveText(lines[0]!)

      // 窗口起点在全量索引中的行号无法换算：跳到末尾（而不是停在文件的第 1 行）
      await statusBar(page).getByRole('button', { name: 'すべて読み込む' }).click()
      await expect(lineCount(page)).toHaveText('120,000 行', { timeout: 30_000 })
      await expect(line(page, 120_000)).toHaveText(lines[119_999]!)
      await expect(followButton(page)).toHaveAttribute('aria-pressed', 'true')
    } finally {
      await app.close()
    }
  })
})

/** 改名，失败（EPERM / EBUSY 等）时每 100ms 重试，最多 ms 毫秒 */
async function renameWithin(from: string, to: string, ms: number): Promise<void> {
  const deadline = Date.now() + ms
  for (;;) {
    try {
      renameSync(from, to)
      return
    } catch (e) {
      if (Date.now() >= deadline) throw e
      await new Promise((r) => setTimeout(r, 100))
    }
  }
}
