import { spawn } from 'node:child_process'
import path from 'node:path'
import {
  desktopItemKey,
  type DesktopItem,
  type DesktopRestoreResult,
  type DesktopSkipReason,
  type DesktopSnapshotItem
} from '@pch/shared'
import type { runPowerShell } from '../../infra/powershell'
import { EXPLORER_RESTORE_SCRIPT } from './collectors/scripts'

export interface RestoreDeps {
  /** child_process.spawn：detached、stdio ignore、windowsHide false、unref；不经 shell */
  spawnDetached: (exe: string, args: string[]) => Promise<void>
  runPowerShell: typeof runPowerShell
  /** 真实实现在 Task 10 组装：VfsService.stat + Promise.race 超时 */
  exists: (path: string, timeoutMs: number) => Promise<'yes' | 'no' | 'unreachable'>
  sleep: (ms: number) => Promise<void>
  logger?: { warn: (msg: string) => void }
}

/** 可启动的 exe 文件名白名单（小写）：这里是安全边界，只启动快照中由主进程采集的项目 */
export const RESTORABLE_EXE = new Set([
  'explorer.exe',
  'winword.exe',
  'excel.exe',
  'powerpnt.exe',
  'code.exe',
  'eclipse.exe'
])

export const RESTORE_GAP_MS = 500
export const EXISTS_TIMEOUT_MS = 3000
export const EXPLORER_SCRIPT_TIMEOUT_MS = 15_000

/** 真实的 spawnDetached：不经 shell；spawn 的 error 事件转为拒绝 */
export function spawnDetached(exe: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(exe, args, { detached: true, stdio: 'ignore', windowsHide: false })
    child.once('error', reject)
    child.once('spawn', () => {
      child.unref()
      resolve()
    })
  })
}

class SkipError extends Error {
  readonly reason: DesktopSkipReason
  constructor(reason: DesktopSkipReason) {
    super(reason)
    this.reason = reason
  }
}

const isClsid = (p: string): boolean => p.startsWith('::{')
const explorerExe = (): string =>
  path.win32.join(process.env.SystemRoot ?? 'C:\\Windows', 'explorer.exe')
const explorerArg = (p: string): string => (isClsid(p) ? `shell:${p}` : p)

function isAllowedExe(exe: string): boolean {
  return path.win32.isAbsolute(exe) && RESTORABLE_EXE.has(path.win32.basename(exe).toLowerCase())
}

function isOpen(item: DesktopItem, openTargets: Set<string>): boolean {
  if (item.kind === 'explorer') {
    return openTargets.has(`explorer-tab:${(item.tabs[0] ?? '').toLowerCase()}`)
  }
  return openTargets.has(desktopItemKey(item))
}

/** 存在性检查：no → missing，unreachable → unreachable（由调用方抛出 SkipError） */
async function requireExists(deps: RestoreDeps, p: string): Promise<void> {
  const r = await deps.exists(p, EXISTS_TIMEOUT_MS)
  if (r === 'no') throw new SkipError('missing')
  if (r === 'unreachable') throw new SkipError('unreachable')
}

async function launchExplorer(
  item: Extract<DesktopItem, { kind: 'explorer' }>,
  deps: RestoreDeps
): Promise<void> {
  const tabs: string[] = []
  let unreachable = false
  for (const tab of item.tabs) {
    if (isClsid(tab)) {
      tabs.push(tab)
      continue
    }
    const r = await deps.exists(tab, EXISTS_TIMEOUT_MS)
    if (r === 'yes') tabs.push(tab)
    else if (r === 'unreachable') unreachable = true
  }
  if (tabs.length === 0) throw new SkipError(unreachable ? 'unreachable' : 'missing')

  const exe = explorerExe()
  let restored = 0
  if (tabs.length > 1) {
    try {
      const out = await deps.runPowerShell(
        EXPLORER_RESTORE_SCRIPT,
        { PCH_TABS: JSON.stringify(tabs) },
        EXPLORER_SCRIPT_TIMEOUT_MS
      )
      const n = Number.parseInt(out.trim(), 10)
      restored = Number.isFinite(n) ? Math.min(Math.max(n, 0), tabs.length) : 0
    } catch (e) {
      deps.logger?.warn(`desktop: explorer tab restore script failed: ${firstLine(e)}`)
    }
  }
  // 单标签直接启动；脚本失败 / 只完成一部分时，剩余标签逐个开成独立窗口
  for (const tab of tabs.slice(restored)) {
    await deps.spawnDetached(exe, [explorerArg(tab)])
  }
}

async function launchOne(item: DesktopItem, deps: RestoreDeps): Promise<void> {
  switch (item.kind) {
    case 'explorer':
      return launchExplorer(item, deps)
    case 'office': {
      requireAllowed(item.exe, deps)
      await requireExists(deps, item.path)
      const args = item.app === 'excel' && item.readOnly ? ['/r', item.path] : [item.path]
      return deps.spawnDetached(item.exe, args)
    }
    case 'vscode': {
      requireAllowed(item.exe, deps)
      if (item.target.startsWith('vscode-remote://')) {
        return deps.spawnDetached(item.exe, ['--folder-uri', item.target])
      }
      await requireExists(deps, item.target)
      return deps.spawnDetached(item.exe, [item.target])
    }
    case 'eclipse':
      requireAllowed(item.exe, deps)
      await requireExists(deps, item.workspace)
      return deps.spawnDetached(item.exe, ['-data', item.workspace])
  }
}

function requireAllowed(exe: string, deps: RestoreDeps): void {
  if (isAllowedExe(exe)) return
  deps.logger?.warn(`desktop: refusing to launch non-whitelisted exe: ${exe}`)
  throw new SkipError('failed')
}

function firstLine(e: unknown): string {
  return (e instanceof Error ? e.message : String(e)).split('\n')[0] ?? ''
}

/**
 * 按快照项目重新启动。已开着 → open；白名单外 → failed；路径不存在 / 连不上 → missing / unreachable
 * （每项存在性检查最多 3000 ms，不随失败项累加）；启动抛错 → failed。项目之间间隔 500 ms。
 */
export async function restoreItems(
  items: DesktopSnapshotItem[],
  openTargets: Set<string>,
  deps: RestoreDeps
): Promise<DesktopRestoreResult> {
  const result: DesktopRestoreResult = { launched: 0, skipped: [] }
  let first = true
  for (const { id, item } of items) {
    if (isOpen(item, openTargets)) {
      result.skipped.push({ itemId: id, reason: 'open' })
      continue
    }
    if (!first) await deps.sleep(RESTORE_GAP_MS)
    first = false
    try {
      await launchOne(item, deps)
      result.launched++
    } catch (e) {
      if (e instanceof SkipError) {
        result.skipped.push({ itemId: id, reason: e.reason })
      } else {
        deps.logger?.warn(`desktop: restore item ${id} failed: ${firstLine(e)}`)
        result.skipped.push({ itemId: id, reason: 'failed' })
      }
    }
  }
  return result
}
