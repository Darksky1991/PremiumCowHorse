import { createRequire } from 'node:module'
import type { DesktopCollector, WindowBounds } from '@pch/shared'

/** 一个可见顶层窗口的信息 */
export interface WindowInfo {
  /** 窗口句柄的数值（与 PowerShell 脚本输出的 HWND 数值可比较） */
  hwnd: number
  pid: number
  /** 进程映像的完整路径；OpenProcess 失败（权限不足等）时为空字符串 */
  exe: string
  className: string
  title: string
  bounds: WindowBounds
}

/** 只含可见顶层窗口 */
export type ListWindows = () => WindowInfo[]

/** exe 文件名（小写）→ 窗口类（精确）与类别；Code.exe 另要求标题非空 */
const RULES: Record<string, { classes: string[]; collector: DesktopCollector }> = {
  'explorer.exe': { classes: ['CabinetWClass'], collector: 'explorer' },
  'winword.exe': { classes: ['OpusApp'], collector: 'office' },
  'excel.exe': { classes: ['XLMAIN'], collector: 'office' },
  'powerpnt.exe': { classes: ['PPTFrameClass'], collector: 'office' },
  'code.exe': { classes: ['Chrome_WidgetWin_1'], collector: 'vscode' },
  'eclipse.exe': { classes: ['SWT_Window0'], collector: 'eclipse' }
}

/** 按进程与窗口类判断窗口属于哪类采集器；不属于任何一类返回 null */
export function collectorOf(w: WindowInfo): DesktopCollector | null {
  const name = w.exe.slice(w.exe.lastIndexOf('\\') + 1).toLowerCase()
  const rule = RULES[name]
  if (!rule || !rule.classes.includes(w.className)) return null
  if (rule.collector === 'vscode' && w.title === '') return null
  return rule.collector
}

/** 每类一个串：按 hwnd 排序的「hwnd + 标题」，窗口集合或标题变化时串才会变 */
export function windowsSignature(ws: WindowInfo[]): Map<DesktopCollector, string> {
  const groups = new Map<DesktopCollector, WindowInfo[]>()
  for (const w of ws) {
    const c = collectorOf(w)
    if (c === null) continue
    const list = groups.get(c)
    if (list) list.push(w)
    else groups.set(c, [w])
  }
  const out = new Map<DesktopCollector, string>()
  for (const [c, list] of groups) {
    out.set(
      c,
      list
        .sort((a, b) => a.hwnd - b.hwnd)
        .map((w) => `${w.hwnd}\t${w.title}`)
        .join('\n')
    )
  }
  return out
}

const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
const TEXT_CHARS = 512
const PATH_CHARS = 1040

/** 加载失败的原因（供排查） */
let loadError: string | undefined
export const listWindowsLoadError = (): string | undefined => loadError

/** 原生调用；pid 缓存的状态由 loadListWindows 返回的闭包持有 */
interface Native {
  enumerate(onWindow: (w: Omit<WindowInfo, 'exe'>) => void): void
  imagePath(pid: number): string
}

/** 进程内只声明一次（koffi 的结构体 / 回调类型同名重复定义会抛错），失败也只记一次 */
let native: Native | null | undefined

function loadNative(): Native | null {
  if (native !== undefined) return native
  if (process.platform !== 'win32') {
    loadError = `not supported on ${process.platform}`
    return (native = null)
  }
  try {
    const koffi = createRequire(import.meta.url)('koffi') as typeof import('koffi')
    const user32 = koffi.load('user32.dll')
    const kernel32 = koffi.load('kernel32.dll')

    const EnumProc = koffi.proto('bool PchEnumWindowsProc(void *hWnd, intptr lParam)')
    const EnumWindows = user32.func('bool EnumWindows(PchEnumWindowsProc *cb, intptr lParam)')
    const IsWindowVisible = user32.func('bool IsWindowVisible(void *hWnd)')
    const GetWindowTextW = user32.func('int GetWindowTextW(void *hWnd, _Out_ uint16 *buf, int max)')
    const GetClassNameW = user32.func('int GetClassNameW(void *hWnd, _Out_ uint16 *buf, int max)')
    const GetWindowThreadProcessId = user32.func(
      'uint32 GetWindowThreadProcessId(void *hWnd, _Out_ uint32 *pid)'
    )
    koffi.struct('PchRECT', { left: 'int32', top: 'int32', right: 'int32', bottom: 'int32' })
    const GetWindowRect = user32.func('bool GetWindowRect(void *hWnd, _Out_ PchRECT *rect)')
    const OpenProcess = kernel32.func('void *OpenProcess(uint32 access, int inherit, uint32 pid)')
    const CloseHandle = kernel32.func('int CloseHandle(void *h)')
    const QueryFullProcessImageNameW = kernel32.func(
      'bool QueryFullProcessImageNameW(void *h, uint32 flags, _Out_ uint16 *buf, _Inout_ uint32 *size)'
    )

    const readText = (fn: typeof GetWindowTextW, hwnd: unknown): string => {
      const buf = Buffer.alloc(TEXT_CHARS * 2)
      const n = fn(hwnd, buf, TEXT_CHARS) as number
      return n > 0 ? buf.toString('utf16le', 0, n * 2) : ''
    }

    return (native = {
      imagePath(pid) {
        let p = ''
        const h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid)
        if (h) {
          try {
            const buf = Buffer.alloc(PATH_CHARS * 2)
            const size = [PATH_CHARS]
            if (QueryFullProcessImageNameW(h, 0, buf, size)) {
              p = buf.toString('utf16le', 0, size[0]! * 2)
            }
          } finally {
            CloseHandle(h)
          }
        }
        return p
      },
      enumerate(onWindow) {
        const cb = koffi.register((hwnd: unknown) => {
          if (!IsWindowVisible(hwnd)) return true
          const pidOut = [0]
          GetWindowThreadProcessId(hwnd, pidOut)
          const rect = { left: 0, top: 0, right: 0, bottom: 0 }
          GetWindowRect(hwnd, rect)
          onWindow({
            // 指针转数值：koffi.address 返回 bigint，窗口句柄只有低 32 位有效，转 number 无损
            hwnd: Number(koffi.address(hwnd)),
            pid: pidOut[0]!,
            className: readText(GetClassNameW, hwnd),
            title: readText(GetWindowTextW, hwnd),
            bounds: {
              x: rect.left,
              y: rect.top,
              width: rect.right - rect.left,
              height: rect.bottom - rect.top
            }
          })
          return true
        }, koffi.pointer(EnumProc))
        try {
          EnumWindows(cb, 0)
        } finally {
          koffi.unregister(cb)
        }
      }
    })
  } catch (e) {
    loadError = e instanceof Error ? e.message : String(e)
    return (native = null)
  }
}

/** 用 koffi 加载窗口枚举；非 Windows 或原生模块缺失返回 null（同 vfs/location.ts 的 loadDriveType） */
export function loadListWindows(): ListWindows | null {
  const n = loadNative()
  if (n === null) return null
  // pid → 进程路径。OpenProcess + QueryFullProcessImageNameW 占枚举耗时的大头，
  // 每轮枚举后清除本轮未出现的 pid（pid 会被复用，不能永久保留）；失败（权限不足）记为空字符串
  const exeCache = new Map<number, string>()
  return () => {
    const result: WindowInfo[] = []
    const seen = new Set<number>()
    n.enumerate((w) => {
      seen.add(w.pid)
      let exe = exeCache.get(w.pid)
      if (exe === undefined) {
        exe = n.imagePath(w.pid)
        exeCache.set(w.pid, exe)
      }
      result.push({ ...w, exe })
    })
    for (const pid of exeCache.keys()) if (!seen.has(pid)) exeCache.delete(pid)
    return result
  }
}
