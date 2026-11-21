import { realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import type { DesktopItem, OfficeApp } from '@pch/shared'
import type { runPowerShell } from '../../../infra/powershell'
import type { WindowInfo } from '../window-list'
import { parseJsonList } from './explorer'
import { OFFICE_SCRIPT } from './scripts'
import type { Collector } from './types'

const APPS: readonly string[] = ['word', 'excel', 'powerpoint']

/** 临时目录前缀（小写，带结尾分隔符）：长名与 8.3 短名都包含 */
function tempPrefixes(): string[] {
  const dirs = new Set<string>()
  const t = tmpdir()
  dirs.add(t)
  try {
    dirs.add(realpathSync.native(t))
  } catch {
    // 目录不存在时只比较原值
  }
  return [...dirs].map((d) => d.replace(/[\\/]+$/, '').toLowerCase() + '\\')
}

function isUnderTemp(path: string, prefixes: string[]): boolean {
  const p = path.toLowerCase().replace(/\//g, '\\')
  return prefixes.some((d) => p.startsWith(d))
}

/**
 * 解析 Office 脚本输出。{"error":...} 抛错（对话框弹着等，本轮失败）；
 * https:// 与临时目录中的文档丢弃；exe 取同 hwnd 的窗口，找不到窗口的项丢弃。
 */
export function parseOfficeOutput(stdout: string, windows: WindowInfo[]): DesktopItem[] {
  const list = parseJsonList(stdout)
  const prefixes = tempPrefixes()
  const items: DesktopItem[] = []
  for (const raw of list) {
    if (typeof raw !== 'object' || raw === null) continue
    const r = raw as Record<string, unknown>
    if (typeof r.error === 'string') throw new Error(`Office collector failed: ${r.error}`)
    const { app, path, readOnly, hwnd } = r
    if (typeof app !== 'string' || !APPS.includes(app)) continue
    if (typeof path !== 'string' || path === '' || typeof hwnd !== 'number') continue
    if (/^https?:\/\//i.test(path) || isUnderTemp(path, prefixes)) continue
    const win = windows.find((w) => w.hwnd === hwnd)
    if (!win) continue
    items.push({
      kind: 'office',
      app: app as OfficeApp,
      path,
      readOnly: readOnly === true,
      exe: win.exe
    })
  }
  return items
}

export function createOfficeCollector(run: typeof runPowerShell, timeoutMs: number): Collector {
  return {
    id: 'office',
    async collect(windows) {
      if (windows.length === 0) return []
      const pids = [...new Set(windows.map((w) => w.pid))]
      const stdout = await run(OFFICE_SCRIPT, { PCH_PIDS: pids.join(',') }, timeoutMs)
      return parseOfficeOutput(stdout, windows)
    }
  }
}
