import { dirname, win32 } from 'node:path'
import type { DesktopItem } from '@pch/shared'
import type { runPowerShell } from '../../../infra/powershell'
import type { WindowInfo } from '../window-list'
import { ECLIPSE_COMMANDLINE_SCRIPT } from './scripts'
import type { Collector } from './types'

/** Java properties 的转义还原（\n \t \r \f \\ \: \= \uXXXX 等；其余 \x 取 x） */
function unescapeProperties(s: string): string {
  return s.replace(/\\(u[0-9a-fA-F]{4}|.)/g, (_m, c: string) => {
    if (c.length === 5) return String.fromCharCode(parseInt(c.slice(1), 16))
    return c === 'n' ? '\n' : c === 't' ? '\t' : c === 'r' ? '\r' : c === 'f' ? '\f' : c
  })
}

/**
 * Eclipse 的 workspace：命令行 `-data <路径>` 优先（只取这一个参数，不保存整串命令行）；
 * 没有时取 prefs（org.eclipse.ui.ide.prefs）的 RECENT_WORKSPACES 第一项。都没有返回 null。
 * `@noDefault`、`@user.home/...` 等占位不是路径，视为没有。
 */
export function parseEclipseWorkspace(
  commandLine: string | null,
  prefs: string | null
): string | null {
  if (commandLine !== null) {
    const m = /(?:^|\s)-data\s+(?:"([^"]*)"|(\S+))/.exec(commandLine)
    const v = m ? (m[1] ?? m[2] ?? '') : ''
    if (v !== '' && !v.startsWith('@')) return v
  }
  if (prefs !== null) {
    const m = /^RECENT_WORKSPACES[ \t]*[=:][ \t]*(.*)$/m.exec(prefs)
    if (m) {
      const first = unescapeProperties(m[1]!.replace(/\r$/, ''))
        .split('\n')
        .find((s) => s.trim() !== '')
      if (first) return first
    }
  }
  return null
}

/** commandLineOf 的真实实现：固定脚本，PID 经环境变量；进程已不存在时返回 null */
export function commandLineViaPowerShell(
  run: typeof runPowerShell,
  timeoutMs: number
): (pid: number) => Promise<string | null> {
  return async (pid) => {
    const out = (await run(ECLIPSE_COMMANDLINE_SCRIPT, { PCH_PID: String(pid) }, timeoutMs)).trim()
    return out === '' ? null : out
  }
}

export function createEclipseCollector(deps: {
  readFile: (p: string) => Promise<string>
  commandLineOf: (pid: number) => Promise<string | null>
}): Collector {
  return {
    id: 'eclipse',
    async collect(windows) {
      // 每个进程一项：取该进程最大的窗口
      const byPid = new Map<number, WindowInfo>()
      for (const w of windows) {
        const cur = byPid.get(w.pid)
        if (!cur || w.bounds.width * w.bounds.height > cur.bounds.width * cur.bounds.height) {
          byPid.set(w.pid, w)
        }
      }
      const items: DesktopItem[] = []
      const seen = new Set<string>()
      for (const [pid, w] of byPid) {
        const cmd = await deps.commandLineOf(pid)
        if (cmd === null) continue
        let workspace = parseEclipseWorkspace(cmd, null)
        if (workspace === null && w.exe !== '') {
          let prefs: string | null = null
          try {
            prefs = await deps.readFile(
              win32.join(dirname(w.exe), 'configuration', '.settings', 'org.eclipse.ui.ide.prefs')
            )
          } catch {
            // prefs 不存在按没有处理
          }
          workspace = parseEclipseWorkspace(null, prefs)
        }
        if (workspace === null || seen.has(workspace.toLowerCase())) continue
        seen.add(workspace.toLowerCase())
        items.push({ kind: 'eclipse', workspace, exe: w.exe, bounds: w.bounds })
      }
      return items
    }
  }
}
