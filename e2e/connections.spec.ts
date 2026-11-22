import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { data, invoke, launch, removeDirs } from './support'
import {
  addConnection,
  connectionRow,
  PASSWORD_METHODS,
  SFTP_HOME,
  startSftp,
  type FakeSftpServer
} from './sftp-support'

/** 「远程连接」视图、连接对话框与主机密钥确认（设计 devDoc/2026-11-22-37 第 5.3、5.8 节） */
test.describe('remote connections', () => {
  let userData: string
  let root: string
  let server: FakeSftpServer
  let app: ElectronApplication | undefined

  test.beforeEach(async () => {
    userData = mkdtempSync(path.join(tmpdir(), 'pch-e2e-'))
    root = mkdtempSync(path.join(tmpdir(), 'pch-e2e-sftp-'))
    server = await startSftp(root)
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

  const hostKeyPrompt = (page: Page): Locator =>
    page.getByRole('alertdialog', { name: 'Trust this server?' })

  const testResult = (row: Locator): Locator => row.getByRole('region', { name: 'Test result' })
  const step = (result: Locator, label: string): Locator =>
    result.getByRole('listitem').filter({ hasText: label })

  test('create, test with host key prompt, wrong password locks once, delete', async () => {
    const page = await start()
    const id = await addConnection(page, server)
    const row = connectionRow(page, 'Fake server')
    await expect(row).toContainText(`pchuser@127.0.0.1:${server.port}`)
    await expect(row).toContainText('Not connected')

    // 第一次测试：弹出主机密钥确认，显示服务器出示的 SHA256 指纹
    await row.getByRole('button', { name: 'Test', exact: true }).click()
    const prompt = hostKeyPrompt(page)
    await expect(prompt).toBeVisible()
    await expect(prompt).toContainText('Fake server')
    await expect(prompt).toContainText(`127.0.0.1:${server.port}`)
    await expect(prompt).toContainText(server.hostKey.algorithm)
    await expect(prompt).toContainText(server.hostKey.fingerprint)
    await prompt.getByRole('button', { name: 'Trust and connect' }).click()
    await expect(prompt).toBeHidden()

    const result = testResult(row)
    for (const label of ['Connect', 'Host key', 'Authentication', 'SFTP']) {
      await expect(step(result, label)).toHaveAttribute('data-ok', 'true')
    }
    await expect(step(result, 'SFTP')).toContainText(SFTP_HOME)
    const trusted = (await data<{ id: string; hostKey: unknown }[]>(page, 'connection.list')).find(
      (c) => c.id === id
    )
    expect(trusted?.hostKey).toEqual(server.hostKey)

    // 编辑：密码框为空（占位「已保存（不变）」），改成错误的密码
    await row.getByRole('button', { name: 'Edit' }).click()
    const dialog = page.getByRole('dialog', { name: 'Edit connection' })
    const password = dialog.getByLabel('Password', { exact: true })
    await expect(password).toHaveValue('')
    await expect(password).toHaveAttribute('placeholder', 'Saved (unchanged)')
    await expect(dialog).toContainText(server.hostKey.fingerprint)
    await password.fill('wrong-password')
    await dialog.getByRole('button', { name: 'Save' }).click()
    await expect(dialog).toBeHidden()

    // 测试：认证失败，行显示「认证失败」与「重新连接」；本次只提交了 1 次密码
    const before = server.authAttempts.length
    await row.getByRole('button', { name: 'Test', exact: true }).click()
    await expect(step(result, 'Authentication')).toHaveAttribute('data-ok', 'false')
    await expect(row).toContainText('Authentication failed')
    await expect(row.getByRole('button', { name: 'Reconnect' })).toBeVisible()
    expect(server.authAttempts.slice(before).filter((m) => PASSWORD_METHODS.includes(m))).toEqual([
      'password'
    ])

    // 删除：确认框 → 列表为空
    await row.getByRole('button', { name: 'Delete' }).click()
    const confirm = page.getByRole('alertdialog', { name: 'Delete this connection?' })
    await expect(confirm).toContainText('No workspace entries use this connection')
    await confirm.getByRole('button', { name: 'Delete' }).click()
    await expect(confirm).toBeHidden()
    await expect(page.getByText('No remote connections yet')).toBeVisible()
    expect(await data<unknown[]>(page, 'connection.list')).toEqual([])
  })

  test('the delete confirmation counts workspace entries that use the connection', async () => {
    const page = await start()
    const id = await addConnection(page, server)
    const row = connectionRow(page, 'Fake server')
    await row.getByRole('button', { name: 'Test', exact: true }).click()
    await hostKeyPrompt(page).getByRole('button', { name: 'Trust and connect' }).click()
    await expect(step(testResult(row), 'SFTP')).toHaveAttribute('data-ok', 'true')

    const workspace = await data<{ id: string }>(page, 'workspace.active')
    const entry = await data(page, 'entry.add', {
      kind: 'folder',
      workspaceId: workspace.id,
      parentId: null,
      uri: `sftp://${id}/home/pchuser`
    })

    await row.getByRole('button', { name: 'Delete' }).click()
    const confirm = page.getByRole('alertdialog', { name: 'Delete this connection?' })
    await expect(confirm).toContainText('Workspace entries using this connection: 1.')
    await confirm.getByRole('button', { name: 'Delete' }).click()
    await expect(page.getByText('No remote connections yet')).toBeVisible()
    // 引用它的条目保留
    const entries = await data<{ id: string }[]>(page, 'entry.list', { workspaceId: workspace.id })
    expect(entries.map((e) => e.id)).toContain(entry.id)
  })

  test('a pending host key prompt survives a renderer reload', async () => {
    const page = await start()
    const id = await addConnection(page, server)
    await connectionRow(page, 'Fake server')
      .getByRole('button', { name: 'Test', exact: true })
      .click()
    await expect(hostKeyPrompt(page)).toBeVisible()

    await page.reload()
    await page.waitForLoadState('domcontentloaded')
    const prompt = hostKeyPrompt(page)
    await expect(prompt).toBeVisible()
    await expect(prompt).toContainText(server.hostKey.fingerprint)
    await prompt.getByRole('button', { name: 'Trust and connect' }).click()
    await expect(prompt).toBeHidden()
    await expect
      .poll(
        async () =>
          (await data<{ id: string; hostKey: unknown }[]>(page, 'connection.list')).find(
            (c) => c.id === id
          )?.hostKey
      )
      .toEqual(server.hostKey)
  })

  test('a prompt answered elsewhere (or timed out) closes in the window', async () => {
    const page = await start()
    await addConnection(page, server)
    const row = connectionRow(page, 'Fake server')
    await row.getByRole('button', { name: 'Test', exact: true }).click()
    await expect(hostKeyPrompt(page)).toBeVisible()

    // 主进程中结束询问（与超时同一路径：gate settle → connection.hostKeyPromptClosed）
    const pending = await data<{ promptId: string }[]>(page, 'connection.pendingHostKeyPrompts')
    expect(pending).toHaveLength(1)
    const res = await invoke(page, 'connection.answerHostKey', {
      promptId: pending[0]!.promptId,
      accept: false
    })
    expect(res.ok).toBe(true)
    await expect(hostKeyPrompt(page)).toBeHidden()
    await expect(step(testResult(row), 'Host key')).toHaveAttribute('data-ok', 'false')
  })

  test('trusting a changed host key from the edit dialog asks for confirmation', async () => {
    const page = await start()
    const id = await addConnection(page, server)
    const row = connectionRow(page, 'Fake server')
    await row.getByRole('button', { name: 'Test', exact: true }).click()
    await hostKeyPrompt(page).getByRole('button', { name: 'Trust and connect' }).click()
    await expect(step(testResult(row), 'SFTP')).toHaveAttribute('data-ok', 'true')
    const oldKey = server.hostKey

    // 同端口、换一把主机密钥重启 → 测试得到「主机密钥已变化」
    const port = server.port
    await server.close()
    server = await startSftp(root, { port })
    await row.getByRole('button', { name: 'Test', exact: true }).click()
    await expect(step(testResult(row), 'Host key')).toHaveAttribute('data-ok', 'false')
    await expect(row).toContainText('Host key changed')

    await row.getByRole('button', { name: 'Edit' }).click()
    const dialog = page.getByRole('dialog', { name: 'Edit connection' })
    await expect(dialog).toContainText(server.hostKey.fingerprint)
    await dialog.getByRole('button', { name: 'Trust new key' }).click()
    const confirm = page.getByRole('alertdialog', { name: 'Trust the new host key?' })
    await expect(confirm).toContainText(oldKey.fingerprint)
    await expect(confirm).toContainText(server.hostKey.fingerprint)
    // 取消则不信任
    await confirm.getByRole('button', { name: 'Cancel' }).click()
    await expect(confirm).toBeHidden()
    const before = (await data<{ id: string; hostKey: unknown }[]>(page, 'connection.list')).find(
      (c) => c.id === id
    )
    expect(before?.hostKey).toEqual(oldKey)

    await dialog.getByRole('button', { name: 'Trust new key' }).click()
    await confirm.getByRole('button', { name: 'Trust', exact: true }).click()
    await expect(confirm).toBeHidden()
    await expect
      .poll(
        async () =>
          (await data<{ id: string; hostKey: unknown }[]>(page, 'connection.list')).find(
            (c) => c.id === id
          )?.hostKey
      )
      .toEqual(server.hostKey)
  })

  test('a key presented after the confirmation opened is not trusted; the dialog shows it instead', async () => {
    const page = await start()
    const id = await addConnection(page, server)
    const row = connectionRow(page, 'Fake server')
    await row.getByRole('button', { name: 'Test', exact: true }).click()
    await hostKeyPrompt(page).getByRole('button', { name: 'Trust and connect' }).click()
    await expect(step(testResult(row), 'SFTP')).toHaveAttribute('data-ok', 'true')
    const oldKey = server.hostKey

    const port = server.port
    await server.close()
    server = await startSftp(root, { port })
    const seen = server.hostKey
    await row.getByRole('button', { name: 'Test', exact: true }).click()
    await expect(row).toContainText('Host key changed')
    await row.getByRole('button', { name: 'Trust new key' }).click()
    const confirm = page.getByRole('alertdialog', { name: 'Trust the new host key?' })
    await expect(confirm).toContainText(seen.fingerprint)

    // 确认框打开期间服务器又换了一把密钥（测试连接经 IPC 触发，记下最新出示的密钥）
    await server.close()
    server = await startSftp(root, { port })
    const newer = server.hostKey
    await data(page, 'connection.test', { id })
    // 信任当时看到的密钥（seen）：已不是服务器最新出示的 → CONN_HOST_KEY_CHANGED，不保存
    // （渲染端的竞争窗口很短，这里直接经 IPC 发送旧的密钥）
    const res = await invoke(page, 'connection.trustHostKey', { id, key: seen })
    expect(res).toMatchObject({ ok: false, error: { code: 'CONN_HOST_KEY_CHANGED' } })
    const after = (await data<{ id: string; hostKey: unknown }[]>(page, 'connection.list')).find(
      (c) => c.id === id
    )
    expect(after?.hostKey).toEqual(oldKey)
    // 确认框显示列表中的最新值：换成最新出示的密钥
    await expect(confirm).toContainText(newer.fingerprint)
    await expect(confirm).not.toContainText(seen.fingerprint)

    await confirm.getByRole('button', { name: 'Trust', exact: true }).click()
    await expect(confirm).toBeHidden()
    await expect
      .poll(
        async () =>
          (await data<{ id: string; hostKey: unknown }[]>(page, 'connection.list')).find(
            (c) => c.id === id
          )?.hostKey
      )
      .toEqual(newer)
  })

  test('the welcome page opens the view; key auth names the sudo choice NOPASSWD', async () => {
    const page = await start()
    await page.getByRole('button', { name: 'Connect to an SFTP server' }).click()
    await expect(page.getByRole('heading', { name: 'Remote connections' })).toBeVisible()

    await page.getByRole('button', { name: 'New connection' }).first().click()
    const dialog = page.getByRole('dialog', { name: 'New connection' })
    await expect(dialog.getByRole('radio', { name: 'Same as login password' })).toBeVisible()
    await dialog.getByRole('radio', { name: 'Private key authentication' }).click()
    await expect(dialog.getByRole('radio', { name: 'No sudo password (NOPASSWD)' })).toBeVisible()
    await expect(dialog.getByRole('radio', { name: 'Same as login password' })).toHaveCount(0)

    // 用户名为空：「必填」而不是格式错误
    await dialog.getByRole('button', { name: 'Save' }).click()
    await expect(dialog).toContainText('Enter a user name')
  })
})
