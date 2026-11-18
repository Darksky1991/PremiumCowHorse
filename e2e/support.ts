import { lstatSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'

const appDir = path.resolve(__dirname, '../apps/desktop')

/** 启动已构建的应用（经 app:// 加载 out/ 中的生产构建）；userData 必须是临时目录 */
export async function launch(
  userDataDir: string
): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    args: [appDir],
    env: { ...process.env, PCH_USER_DATA_DIR: userDataDir, ELECTRON_RENDERER_URL: '' }
  })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  return { app, page }
}

export type IpcResult = { ok: true; data: unknown } | { ok: false; error: { code: string } }
export type Named = { id: string; name: string; label: string; uri: string }

/** 经 window.pch 调用主进程，返回 IpcResult */
export const invoke = (page: Page, channel: string, input?: unknown): Promise<IpcResult> =>
  page.evaluate(([c, i]) => window.pch!.invoke(c as string, i) as Promise<IpcResult>, [
    channel,
    input
  ] as const)

/** 调用并断言成功，返回 data */
export const data = async <T = Named>(page: Page, channel: string, input?: unknown): Promise<T> => {
  const res = await invoke(page, channel, input)
  if (!res.ok) throw new Error(`${channel} failed: ${JSON.stringify(res)}`)
  return res.data as T
}

/**
 * 目录的递归快照：每项一行「相对路径 | 类型 | 大小 | mtime」（lstat，不跟随链接），按路径排序。
 * 拖放前后比较快照，证明磁盘上没有任何文件或目录被新建、删除、移动或修改。
 */
export function snapshotTree(root: string): string[] {
  const lines: string[] = []
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name)
      const st = lstatSync(full)
      const kind = st.isDirectory() ? 'dir' : st.isSymbolicLink() ? 'link' : 'file'
      lines.push(`${path.relative(root, full)}|${kind}|${st.size}|${st.mtimeMs}`)
      if (st.isDirectory()) walk(full)
    }
  }
  lines.push(`.|dir|${lstatSync(root).mtimeMs}`)
  walk(root)
  return lines.sort()
}

/** 错误行的可访问名称包含「重试」按钮的文字 */
export const retryLabel = '再試行|重试|Retry'
