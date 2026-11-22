import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { expect, type Page } from '@playwright/test'
import {
  startFakeSftpServer,
  type FakeSftpServer
} from '../apps/desktop/src/main/modules/connection/testing/fake-sftp-server'
import { data } from './support'

export type { FakeSftpServer }

/** 假服务器的登录用户与密码 */
export const SFTP_USER = 'pchuser'
export const SFTP_PASSWORD = 'Pch-pass1'
/** 登录用户的主目录（realpath('.') 的结果）；root 下会建立对应目录 */
export const SFTP_HOME = '/home/pchuser'

/** 认证尝试中提交密码的方式（ssh2 的方法名） */
export const PASSWORD_METHODS = ['password', 'keyboard-interactive']

/**
 * 在测试进程中启动假 SFTP 服务器（真实的 ssh2 Server，只监听 127.0.0.1），root 映射为服务器的 /。
 * 用例结束时调用 close()
 */
export async function startSftp(root: string): Promise<FakeSftpServer> {
  mkdirSync(path.join(root, ...SFTP_HOME.split('/').filter(Boolean)), { recursive: true })
  return startFakeSftpServer({ root, users: { [SFTP_USER]: SFTP_PASSWORD }, home: SFTP_HOME })
}

/** 打开活动栏的「远程连接」视图（以英文界面为前提） */
export async function openConnectionsView(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Remote connections', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Remote connections' })).toBeVisible()
}

/**
 * 经界面新建连接（主机 127.0.0.1、假服务器端口、pchuser、密码），返回连接 id。
 * 以英文界面为前提
 */
export async function addConnection(
  page: Page,
  server: FakeSftpServer,
  name = 'Fake server'
): Promise<string> {
  await openConnectionsView(page)
  // 标题行的按钮（空状态中还有一个同名按钮）
  await page.getByRole('button', { name: 'New connection' }).first().click()
  const dialog = page.getByRole('dialog', { name: 'New connection' })
  await dialog.getByLabel('Name', { exact: true }).fill(name)
  await dialog.getByLabel('Host', { exact: true }).fill('127.0.0.1')
  await dialog.getByLabel('Port', { exact: true }).fill(String(server.port))
  await dialog.getByLabel('User name', { exact: true }).fill(SFTP_USER)
  await dialog.getByLabel('Password', { exact: true }).fill(SFTP_PASSWORD)
  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect(dialog).toBeHidden()
  await expect(connectionRow(page, name)).toBeVisible()
  const list = await data<{ id: string; name: string }[]>(page, 'connection.list')
  const found = list.find((c) => c.name === name)
  if (!found) throw new Error(`connection ${name} was not saved`)
  return found.id
}

/** 「远程连接」视图中的一行 */
export const connectionRow = (page: Page, name: string): ReturnType<Page['getByRole']> =>
  page
    .getByRole('list', { name: 'Remote connections' })
    .getByRole('listitem')
    .filter({ has: page.getByText(name, { exact: true }) })
