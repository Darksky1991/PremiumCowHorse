import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { DesktopItem, WindowBounds } from '@pch/shared'
import type { WindowInfo } from '../window-list'
import type { Collector } from './types'

/** 只读读取文本文件（读完即关，不持有句柄）；其他程序的状态文件用它读 */
export const readTextFile = (p: string): Promise<string> => readFile(p, 'utf8')

const TITLE_SUFFIX = ' - Visual Studio Code'

/** file: URI → 本地路径（含 UNC）；vscode-remote:// 原样；其他形态返回 null */
function uriToTarget(uri: string): string | null {
  if (/^vscode-remote:\/\//i.test(uri)) return uri
  const m = /^file:\/\/([^/]*)(\/.*)?$/i.exec(uri)
  if (!m) return null
  let path = decodeURIComponent(m[2] ?? '')
  if (m[1] !== '' && m[1]!.toLowerCase() !== 'localhost') {
    return `\\\\${m[1]}${path.replace(/\//g, '\\')}` // UNC
  }
  path = path.replace(/^\/([A-Za-z]:)/, '$1')
  return path.replace(/\//g, '\\')
}

/** 目标的「根名」：文件夹为最后一段，工作区为文件名去掉 .code-workspace；vscode-remote 同文件夹 */
function rootNameOf(target: string): string {
  const base = decodeURIComponent(target.split(/[\\/]/).filter(Boolean).pop() ?? '')
  return base.replace(/\.code-workspace$/i, '')
}

interface Entry {
  target: string
  name: string
  isWorkspace: boolean
  lastActive: boolean
  /** 状态文件的 uiState（窗口最小化时矩形无效，退回它） */
  ui: WindowBounds | null
}

function entryOf(raw: unknown, lastActive: boolean): Entry | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as {
    folder?: unknown
    workspaceIdentifier?: { configURIPath?: unknown }
    uiState?: { x?: unknown; y?: unknown; width?: unknown; height?: unknown }
  }
  const uri =
    typeof r.folder === 'string'
      ? r.folder
      : typeof r.workspaceIdentifier?.configURIPath === 'string'
        ? r.workspaceIdentifier.configURIPath
        : null
  if (uri === null) return null
  const target = uriToTarget(uri)
  if (target === null) return null
  const isWorkspace = typeof r.folder !== 'string'
  const u = r.uiState
  const ui =
    typeof u?.x === 'number' &&
    typeof u.y === 'number' &&
    typeof u.width === 'number' &&
    typeof u.height === 'number'
      ? { x: u.x, y: u.y, width: u.width, height: u.height }
      : null
  return { target, name: rootNameOf(target), isWorkspace, lastActive, ui }
}

/** 标题以 `<根名>`（工作区为 `<名> (Workspace)`，远程可带 ` [WSL: x]` 后缀）结尾时匹配 */
function titleMatches(head: string, e: Entry): boolean {
  const name = e.name.toLowerCase()
  const roots = e.isWorkspace ? [`${name} (workspace)`] : [name]
  const h = head.toLowerCase().replace(/ \[[^\]]*\]$/, '')
  return roots.some((root) => h === root || h.endsWith(` - ${root}`))
}

/** 最小化窗口的矩形被系统移到屏幕外（实测 -21333,-21333，158x26；经典值 -32000） */
const isMinimizedRect = (b: WindowBounds): boolean => b.x <= -20000 && b.y <= -20000

/**
 * storage.json 只在打开窗口后写入、关闭时不写，不能表示「现在开着什么」。
 * 以可见 Code 窗口的标题（`<活动编辑器> - <根名> - Visual Studio Code`）与 lastActiveWindow + openedWindows
 * 中各项的根名匹配，只输出匹配上的项。同名多项时取 lastActiveWindow 中的那个，否则取 openedWindows 中第一个；
 * 同一 target 只输出一次；标题只有「Visual Studio Code」或匹配不到的窗口忽略。bounds 取窗口矩形（状态文件不随窗口移动实时更新）；
 * 窗口最小化时矩形无效，退回该项的 uiState（没有则 null）。窗口标题的 (Workspace) 为英文版 VS Code 的写法，其他界面语言未验证。
 */
export function parseVscodeState(json: string, windows: WindowInfo[]): DesktopItem[] {
  const state = JSON.parse(json) as {
    windowsState?: { lastActiveWindow?: unknown; openedWindows?: unknown }
  }
  const ws = state.windowsState
  if (!ws) return []
  const entries: Entry[] = []
  const last = entryOf(ws.lastActiveWindow, true)
  if (last) entries.push(last)
  if (Array.isArray(ws.openedWindows)) {
    for (const raw of ws.openedWindows) {
      const e = entryOf(raw, false)
      if (e && !entries.some((x) => x.target.toLowerCase() === e.target.toLowerCase())) {
        entries.push(e)
      }
    }
  }
  const items: DesktopItem[] = []
  const seen = new Set<string>()
  for (const w of windows) {
    if (!w.title.endsWith(TITLE_SUFFIX)) continue
    const head = w.title.slice(0, -TITLE_SUFFIX.length)
    if (head === '') continue
    const hits = entries.filter((e) => titleMatches(head, e))
    const hit = hits.find((e) => e.lastActive) ?? hits[0]
    if (!hit) continue
    const key = hit.target.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    items.push({
      kind: 'vscode',
      target: hit.target,
      exe: w.exe,
      bounds: isMinimizedRect(w.bounds) ? hit.ui : w.bounds
    })
  }
  return items
}

export function createVscodeCollector(deps: {
  readFile: (p: string) => Promise<string>
  appData: string
}): Collector {
  return {
    id: 'vscode',
    async collect(windows) {
      if (windows.length === 0) return []
      const json = await deps.readFile(
        join(deps.appData, 'Code', 'User', 'globalStorage', 'storage.json')
      )
      return parseVscodeState(json, windows)
    }
  }
}
