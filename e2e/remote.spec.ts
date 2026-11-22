import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { generateEd25519KeyPair } from '../apps/desktop/src/main/modules/connection/testing/test-keys'
import { data, launch, removeDirs, toggleRow } from './support'
import {
  addConnection,
  connectionRow,
  SFTP_HOME,
  startSftp,
  type FakeSftpServer
} from './sftp-support'

/**
 * 远程文件夹（设计 devDoc/2026-11-22-37 第 5.1、5.8 节）：添加对话框、远程条目的图标与菜单、
 * 文件信息的显示路径、建立索引后的搜索、断开图标与恢复
 */
test.describe('remote folders', () => {
  let userData: string
  let root: string
  /** 同端口同密钥重启用：首次启动的主机密钥（PEM） */
  let hostKeyPem: string
  let server: FakeSftpServer
  let app: ElectronApplication | undefined

  test.beforeEach(async () => {
    userData = mkdtempSync(path.join(tmpdir(), 'pch-e2e-'))
    root = mkdtempSync(path.join(tmpdir(), 'pch-e2e-sftp-'))
    const home = path.join(root, ...SFTP_HOME.split('/').filter(Boolean))
    mkdirSync(path.join(home, 'logs'), { recursive: true })
    writeFileSync(path.join(home, 'logs', 'app.log'), 'started\n')
    // 10 个子目录：建立索引要逐个读取；d07 之下的文件只有建立索引后才搜得到（从未展开）
    for (let i = 1; i <= 10; i++) mkdirSync(path.join(home, `d${String(i).padStart(2, '0')}`))
    writeFileSync(path.join(home, 'd07', 'deep.txt'), 'deep')
    mkdirSync(path.join(root, 'opt', 'data'), { recursive: true })
    writeFileSync(path.join(root, 'opt', 'data', 'a b.txt'), 'a b')
    hostKeyPem = generateEd25519KeyPair().private
    server = await startSftp(root, { hostKey: hostKeyPem })
  })
  test.afterEach(async () => {
    await app?.close()
    app = undefined
    await server.close()
    removeDirs(userData, root)
  })

  /** 以英文界面启动 */
  const start = async (): Promise<Page> => {
    const launched = await launch(userData)
    app = launched.app
    await data(launched.page, 'settings.set', { 'general.language': 'en' })
    await expect(launched.page.locator('html')).toHaveAttribute('lang', 'en')
    return launched.page
  }

  /** 新建连接并经「测试」信任主机密钥 */
  const addTrustedConnection = async (page: Page): Promise<string> => {
    const id = await addConnection(page, server)
    const row = connectionRow(page, 'Fake server')
    await row.getByRole('button', { name: 'Test', exact: true }).click()
    await page
      .getByRole('alertdialog', { name: 'Trust this server?' })
      .getByRole('button', { name: 'Trust and connect' })
      .click()
    await expect(
      row.getByRole('region', { name: 'Test result' }).getByRole('listitem').filter({
        hasText: 'SFTP'
      })
    ).toHaveAttribute('data-ok', 'true')
    return id
  }

  /** 资源管理器空状态的「添加远程文件夹」→ 默认路径为登录用户的主目录 → 添加 */
  const addRemoteFolder = async (page: Page): Promise<Locator> => {
    await page.getByRole('button', { name: 'Explorer', exact: true }).click()
    await page.getByRole('button', { name: /^Add remote folder/ }).click()
    const dialog = page.getByRole('dialog', { name: 'Add remote folder' })
    await expect(dialog.getByRole('button', { name: 'Connection', exact: true })).toContainText(
      'Fake server'
    )
    await expect(dialog.getByLabel('Path', { exact: true })).toHaveValue(SFTP_HOME)
    await dialog.getByRole('button', { name: 'Add', exact: true }).click()
    await expect(dialog).toBeHidden()
    const entry = page.getByRole('tree').getByRole('treeitem', { name: 'pchuser' })
    await expect(entry).toBeVisible()
    return entry
  }

  test('add a remote folder, browse it, file info without system actions, copy path', async () => {
    const page = await start()
    const id = await addTrustedConnection(page)
    const entry = await addRemoteFolder(page)
    const workspace = await data<{ id: string }>(page, 'workspace.active')
    const entries = await data<{ label: string; uri: string }[]>(page, 'entry.list', {
      workspaceId: workspace.id
    })
    expect(entries.map((e) => [e.label, e.uri])).toEqual([['pchuser', `sftp://${id}/home/pchuser`]])
    // 远程条目的图标区别于本地
    await expect(entry.getByRole('img', { name: 'Remote folder' })).toBeVisible()

    // 展开 → logs；单击 app.log → 文件信息，位置为 <连接名>:<路径>，没有系统动作
    const tree = page.getByRole('tree')
    await toggleRow(entry)
    await toggleRow(tree.getByRole('treeitem', { name: 'logs' }))
    await tree.getByRole('treeitem', { name: 'app.log' }).click()
    await expect(page.getByRole('heading', { name: 'app.log' })).toBeVisible()
    await expect(page.getByText('Fake server:/home/pchuser/logs/app.log')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Copy path' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Open with default app' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Reveal in File Explorer' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'View as text' })).toHaveCount(0)
    // 标签的悬停提示也是显示路径
    await expect(page.getByRole('tab', { name: 'app.log' })).toHaveAttribute(
      'title',
      'Fake server:/home/pchuser/logs/app.log'
    )

    // 右键远程条目：没有「在资源管理器中显示」「缓存策略」；「复制路径」= 服务器上的绝对路径
    const clipboard = (): Promise<string> => app!.evaluate(({ clipboard }) => clipboard.readText())
    await app!.evaluate(({ clipboard }) => clipboard.writeText('before'))
    await entry.click({ button: 'right' })
    const copyPath = page.getByRole('menuitem', { name: 'Copy path' })
    await expect(copyPath).toBeVisible()
    await expect(page.getByRole('menuitem', { name: 'Reveal in File Explorer' })).toHaveCount(0)
    await expect(page.getByRole('menuitem', { name: 'Cache strategy' })).toHaveCount(0)
    await copyPath.click()
    await expect.poll(clipboard).toBe(SFTP_HOME)
  })

  test('build index on a remote folder, search, reveal in tree; disconnect and recover', async () => {
    const page = await start()
    await addTrustedConnection(page)
    const entry = await addRemoteFolder(page)
    const tree = page.getByRole('tree')

    // 建立索引 → 从未展开的 d07 之下的文件也进入缓存（搜索视图不随缓存变化重新查询：
    // 先经 search.query 等到索引完成（没有未扫描的目录），再在界面中搜索）
    await entry.click({ button: 'right' })
    await page.getByRole('menuitemcheckbox', { name: /^Build index/ }).click()
    const workspace = await data<{ id: string }>(page, 'workspace.active')
    let request = 0
    await expect
      .poll(
        async () =>
          await data<{ total: number; incomplete: boolean }>(page, 'search.query', {
            workspaceId: workspace.id,
            text: 'deep.txt',
            kind: 'all',
            requestId: `poll-${request++}`
          }),
        { timeout: 30_000 }
      )
      .toMatchObject({ total: 1, incomplete: false })
    await page.getByRole('button', { name: 'Search', exact: true }).click()
    const input = page.getByRole('searchbox', { name: 'File name' })
    const results = page.getByRole('listbox')
    await input.fill('deep.txt')
    await expect(results.getByRole('option')).toHaveCount(1)
    await expect(results.getByRole('option', { name: /deep\.txt/ })).toContainText('pchuser › d07')

    // 搜索 app.log 得到 1 条，点击定位到树中（展开 logs、选中该行）
    await input.fill('app.log')
    const hit = results.getByRole('option', { name: /app\.log/ })
    await expect(hit).toBeVisible()
    await expect(results.getByRole('option')).toHaveCount(1)
    await expect(hit).toHaveAttribute('title', 'Fake server:/home/pchuser/logs/app.log')
    await hit.click()
    const row = tree.getByRole('treeitem', { name: 'app.log' })
    await expect(row).toHaveAttribute('aria-selected', 'true')
    await expect(tree.getByRole('treeitem', { name: 'logs' })).toHaveAttribute(
      'aria-expanded',
      'true'
    )

    // 停止服务器 → 刷新（F5）后条目显示断开图标
    const disconnected = entry.getByRole('img', { name: 'Disconnected' })
    await expect(disconnected).toHaveCount(0)
    const port = server.port
    await server.close()
    await tree.focus()
    await page.keyboard.press('F5')
    await expect(disconnected).toBeVisible({ timeout: 30_000 })

    // 同端口同密钥重新启动 → 刷新后恢复
    server = await startSftp(root, { port, hostKey: hostKeyPem })
    await expect(async () => {
      await tree.focus()
      await page.keyboard.press('F5')
      await expect(disconnected).toHaveCount(0, { timeout: 2000 })
    }).toPass({ timeout: 30_000 })
  })
})
