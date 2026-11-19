import { lstatSync, readdirSync, rmSync } from 'node:fs'
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
 * 启动后把本地定期确认的三层间隔（关注点 / 近 / 远，默认 5 / 30 / 120 秒）都设为下限 2 秒，
 * 让「下一次检查」在用例的等待时间内发生。
 * 在添加任何条目之前设置：调度器已排期的目录不会因设置变化而提前（只影响之后的排期）。
 */
export async function launchFast(
  userData: string
): Promise<{ app: ElectronApplication; page: Page }> {
  const launched = await launch(userData)
  await data(launched.page, 'settings.set', {
    'cache.interval.focus.local': 2,
    'cache.interval.near.local': 2,
    'cache.interval.far.local': 2
  })
  return launched
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

/**
 * 删除测试用的临时目录：每个目录各自尝试（一个失败不影响其余），全部尝试后再报告失败。
 * 应用刚退出时其文件句柄可能尚未释放（EBUSY / EPERM）；force 只忽略 ENOENT，所以要重试。
 */
export function removeDirs(...dirs: string[]): void {
  const errors: unknown[] = []
  for (const dir of dirs) {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    } catch (e) {
      errors.push(e)
    }
  }
  if (errors.length > 0) throw new AggregateError(errors, 'cannot remove test directories')
}
