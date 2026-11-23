import { lstatSync, readdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import {
  _electron as electron,
  type ElectronApplication,
  type Locator,
  type Page
} from '@playwright/test'

const appDir = path.resolve(__dirname, '../apps/desktop')

/**
 * 桌面记录默认用假模式、现场为空：其他套件不读取 / 不受真实桌面（本机开着的资源管理器、Office 等）影响，
 * 也不在 PowerShell 采集上花时间。desktop.spec 经 env 覆盖
 */
const DESKTOP_DEFAULTS: Record<string, string> = {
  PCH_E2E_FAKE_DESKTOP: '1',
  PCH_E2E_DESKTOP_ITEMS: '[]',
  PCH_E2E_LOGON_AT: '1'
}

/**
 * 启动已构建的应用（经 app:// 加载 out/ 中的生产构建）；userData 必须是临时目录。
 * env 追加测试用的环境变量（例如 PCH_E2E_CRASH_PLUGIN），可覆盖 DESKTOP_DEFAULTS
 */
export async function launch(
  userDataDir: string,
  env: Record<string, string> = {}
): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    args: [appDir],
    env: {
      ...process.env,
      ...DESKTOP_DEFAULTS,
      PCH_USER_DATA_DIR: userDataDir,
      ELECTRON_RENDERER_URL: '',
      ...env
    }
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
  userData: string,
  env: Record<string, string> = {}
): Promise<{ app: ElectronApplication; page: Page }> {
  const launched = await launch(userData, env)
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

/**
 * 主进程测试钩子：以与产品相同的信封向窗口发出 vfs.reachability（不新增产品 IPC）。
 * 只改变渲染端的可达状态；扫描进程仍认为该位置在线（真实断开无法在 e2e 中制造）
 */
export async function sendReachability(
  app: ElectronApplication,
  share: string,
  state: 'offline' | 'online'
): Promise<void> {
  await app.evaluate(
    ({ BrowserWindow }, e) => {
      for (const w of BrowserWindow.getAllWindows()) {
        w.webContents.send('pch:event', { event: 'vfs.reachability', payload: e })
      }
    },
    { share, state, since: Date.now() }
  )
}

export interface HungStat {
  /** 钩子安装以来渲染端发出的 vfs.stat 次数 */
  calls(): Promise<number>
  /** 恢复原来的处理（之后的 vfs.stat 照常；已卡住的调用不会返回） */
  restore(): Promise<void>
}

/**
 * 让主进程的 vfs.stat 一直不返回（模拟无响应的共享上 stat 卡住，产品中要等到超时）。
 * 替换 IPC 通道 pch:invoke 的处理：取出 ipcMain 内部登记的处理函数（Electron 的内部字段
 * _invokeHandlers，Electron 45 中为 Map<通道, 处理函数>，存的就是 handle 传入的函数），
 * 除 vfs.stat 外都交给它。不新增产品代码
 */
export async function hangStat(app: ElectronApplication): Promise<HungStat> {
  await app.evaluate(({ ipcMain }) => {
    type Handler = (event: unknown, envelope: unknown) => unknown
    const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, Handler> })
      ._invokeHandlers
    const original = handlers.get('pch:invoke')
    if (!original) throw new Error('pch:invoke handler not found')
    const hook = { original, calls: 0 }
    ;(globalThis as { __pchHungStat?: typeof hook }).__pchHungStat = hook
    ipcMain.removeHandler('pch:invoke')
    ipcMain.handle('pch:invoke', (event, envelope: unknown) => {
      if ((envelope as { channel?: unknown } | null)?.channel === 'vfs.stat') {
        hook.calls += 1
        return new Promise(() => undefined)
      }
      return original(event, envelope)
    })
  })
  return {
    calls: () =>
      app.evaluate(
        () => (globalThis as { __pchHungStat?: { calls: number } }).__pchHungStat!.calls
      ),
    restore: () =>
      app.evaluate(({ ipcMain }) => {
        const hook = (
          globalThis as {
            __pchHungStat?: { original: (event: unknown, envelope: unknown) => unknown }
          }
        ).__pchHungStat!
        ipcMain.removeHandler('pch:invoke')
        ipcMain.handle('pch:invoke', (event, envelope: unknown) => hook.original(event, envelope))
      })
  }
}

/**
 * 让主进程的某个 IPC 通道延迟 ms 毫秒后再处理（模拟慢的写操作，观察「处理中」的界面）。
 * 与 hangStat 相同的做法：替换 pch:invoke 的处理，其余通道照常交给原处理函数。不新增产品代码
 */
export async function delayInvoke(
  app: ElectronApplication,
  channel: string,
  ms: number
): Promise<void> {
  await app.evaluate(
    ({ ipcMain }, [target, delay]) => {
      type Handler = (event: unknown, envelope: unknown) => unknown
      const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, Handler> })
        ._invokeHandlers
      const original = handlers.get('pch:invoke')
      if (!original) throw new Error('pch:invoke handler not found')
      ipcMain.removeHandler('pch:invoke')
      ipcMain.handle('pch:invoke', async (event, envelope: unknown) => {
        if ((envelope as { channel?: unknown } | null)?.channel === target) {
          await new Promise((resolve) => setTimeout(resolve, delay))
        }
        return original(event, envelope)
      })
    },
    [channel, ms] as const
  )
}

/**
 * 单击资源树一行的展开箭头：只展开 / 折叠，不选中、不打开标签（M1-3b 起单击行在当前标签打开、
 * 目录单击不展开）。用于只需要展开、不关心打开的用例
 */
export async function toggleRow(row: Locator): Promise<void> {
  await row.locator('[data-tree-toggle]').click()
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
