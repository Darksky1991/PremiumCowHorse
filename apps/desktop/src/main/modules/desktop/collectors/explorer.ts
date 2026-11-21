import type { DesktopItem } from '@pch/shared'
import type { runPowerShell } from '../../../infra/powershell'
import type { WindowInfo } from '../window-list'
import { EXPLORER_SCRIPT } from './scripts'
import type { Collector } from './types'

/** 脚本输出为空（没有项目）、单个对象、数组三种形态都接受；非法 JSON 抛错 */
export function parseJsonList(stdout: string): unknown[] {
  const text = stdout.trim()
  if (text === '') return []
  const v: unknown = JSON.parse(text)
  return Array.isArray(v) ? v : [v]
}

/** 解析资源管理器脚本输出；hwnd 不在 windows 中的项丢弃，bounds 取窗口矩形 */
export function parseExplorerOutput(stdout: string, windows: WindowInfo[]): DesktopItem[] {
  const merged = new Map<number, string[]>()
  for (const raw of parseJsonList(stdout)) {
    if (typeof raw !== 'object' || raw === null) continue
    const { hwnd, tabs } = raw as { hwnd?: unknown; tabs?: unknown }
    if (typeof hwnd !== 'number') continue
    const list = Array.isArray(tabs) ? tabs : typeof tabs === 'string' ? [tabs] : []
    const paths = list.filter((t): t is string => typeof t === 'string' && t !== '')
    merged.set(hwnd, [...(merged.get(hwnd) ?? []), ...paths])
  }
  const items: DesktopItem[] = []
  for (const [hwnd, tabs] of merged) {
    const win = windows.find((w) => w.hwnd === hwnd)
    if (!win || tabs.length === 0) continue
    items.push({ kind: 'explorer', tabs, bounds: win.bounds })
  }
  return items
}

export function createExplorerCollector(run: typeof runPowerShell, timeoutMs: number): Collector {
  return {
    id: 'explorer',
    async collect(windows) {
      if (windows.length === 0) return []
      const stdout = await run(
        EXPLORER_SCRIPT,
        { PCH_HWNDS: windows.map((w) => String(w.hwnd)).join(',') },
        timeoutMs
      )
      return parseExplorerOutput(stdout, windows)
    }
  }
}
