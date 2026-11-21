import { describe, expect, it, vi } from 'vitest'
import type { WindowInfo } from '../window-list'
import { createVscodeCollector, parseVscodeState } from './vscode'

const bounds = { x: 10, y: 20, width: 800, height: 600 }
const exe = 'C:\\Program Files\\Microsoft VS Code\\Code.exe'
const win = (hwnd: number, title: string, b = bounds): WindowInfo => ({
  hwnd,
  pid: 100,
  exe,
  className: 'Chrome_WidgetWin_1',
  title,
  bounds: b
})

// 结构取自本机 storage.json 的实测（folder 为 file:/// URI，工作区为 workspaceIdentifier.configURIPath）
const storage = JSON.stringify({
  windowsState: {
    lastActiveWindow: {
      workspaceIdentifier: {
        id: 'f8f6',
        configURIPath: 'file:///c%3A/Users/yongjun.fu/Desktop/ws/ws-b.code-workspace'
      },
      uiState: { mode: 1, x: 0, y: 0, width: 1286, height: 753 }
    },
    openedWindows: [
      { folder: 'file:///c%3A/Users/yongjun.fu/Desktop/PremiumCowHorse' },
      { folder: 'file:///c%3A/Users/x/proj' },
      {
        workspaceIdentifier: {
          id: 'f8f6',
          configURIPath: 'file:///c%3A/Users/yongjun.fu/Desktop/ws/ws-b.code-workspace'
        }
      },
      { folder: 'vscode-remote://wsl%2Bubuntu/home/x/remote-proj' }
    ]
  }
})

describe('parseVscodeState', () => {
  it('file: URI 转本地路径', () => {
    const r = parseVscodeState(storage, [win(1, 'index.ts - proj - Visual Studio Code')])
    expect(r).toEqual([{ kind: 'vscode', target: 'c:\\Users\\x\\proj', exe, bounds }])
  })

  it('工作区标题 <名> (Workspace) 匹配 .code-workspace 文件名；标题大小写不敏感', () => {
    const r = parseVscodeState(storage, [
      win(1, 'WS-B (Workspace) - Visual Studio Code'),
      win(2, 'a.ts - PREMIUMCOWHORSE - Visual Studio Code')
    ])
    expect(r.map((i) => (i.kind === 'vscode' ? i.target : ''))).toEqual([
      'c:\\Users\\yongjun.fu\\Desktop\\ws\\ws-b.code-workspace',
      'c:\\Users\\yongjun.fu\\Desktop\\PremiumCowHorse'
    ])
  })

  it('vscode-remote:// 原样保留（标题带 [WSL: Ubuntu] 后缀）', () => {
    const r = parseVscodeState(storage, [
      win(1, 'main.ts - remote-proj [WSL: Ubuntu] - Visual Studio Code')
    ])
    expect(r).toMatchObject([{ target: 'vscode-remote://wsl%2Bubuntu/home/x/remote-proj' }])
  })

  it('没有窗口、只有 Visual Studio Code 的标题、匹配不到的标题都忽略', () => {
    expect(parseVscodeState(storage, [])).toEqual([])
    expect(parseVscodeState(storage, [win(1, 'Visual Studio Code')])).toEqual([])
    expect(parseVscodeState(storage, [win(1, 'x.ts - unknown - Visual Studio Code')])).toEqual([])
    expect(parseVscodeState(storage, [win(1, 'proj - Notepad')])).toEqual([])
  })

  it('bounds 取窗口矩形，同一 target 只输出一次', () => {
    const r = parseVscodeState(storage, [
      win(1, 'a - proj - Visual Studio Code', { x: 1, y: 2, width: 3, height: 4 }),
      win(2, 'b - proj - Visual Studio Code')
    ])
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({ bounds: { x: 1, y: 2, width: 3, height: 4 } })
  })

  it('窗口最小化（矩形在屏幕外）时 bounds 退回 uiState，没有 uiState 为 null', () => {
    const off = { x: -21333, y: -21333, width: 158, height: 26 }
    const r = parseVscodeState(storage, [
      win(1, 'WS-B (Workspace) - Visual Studio Code', off),
      win(2, 'a - proj - Visual Studio Code', off)
    ])
    expect(r[0]).toMatchObject({ bounds: { x: 0, y: 0, width: 1286, height: 753 } })
    expect(r[1]).toMatchObject({ bounds: null })
  })

  it('字面 % 的本地文件夹名不抛错，其余项照常输出', () => {
    const s = JSON.stringify({
      windowsState: {
        openedWindows: [
          { folder: 'file:///c%3A/work/100%25' },
          { folder: 'file:///c%3A/work/%2541' },
          { folder: 'file:///c%3A/Users/x/proj' }
        ]
      }
    })
    const r = parseVscodeState(s, [
      win(1, 'a - 100% - Visual Studio Code'),
      win(2, 'a - %41 - Visual Studio Code'),
      win(3, 'a - proj - Visual Studio Code')
    ])
    expect(r.map((i) => (i.kind === 'vscode' ? i.target : ''))).toEqual([
      'c:\\work\\100%',
      'c:\\work\\%41',
      'c:\\Users\\x\\proj'
    ])
  })

  it('缩放 175% 的最小化矩形（-18286）也退回 uiState', () => {
    const r = parseVscodeState(storage, [
      win(1, 'WS-B (Workspace) - Visual Studio Code', {
        x: -18286,
        y: -18286,
        width: 90,
        height: 15
      })
    ])
    expect(r[0]).toMatchObject({ bounds: { x: 0, y: 0, width: 1286, height: 753 } })
  })

  it('同名（不同路径）时优先 lastActiveWindow，否则取 openedWindows 中第一个', () => {
    const dup = JSON.stringify({
      windowsState: {
        lastActiveWindow: { folder: 'file:///d%3A/b/proj' },
        openedWindows: [{ folder: 'file:///c%3A/a/proj' }, { folder: 'file:///d%3A/b/proj' }]
      }
    })
    const w = [win(1, 'x - proj - Visual Studio Code')]
    expect(parseVscodeState(dup, w)).toMatchObject([{ target: 'd:\\b\\proj' }])
    const dup2 = JSON.stringify({
      windowsState: {
        openedWindows: [{ folder: 'file:///c%3A/a/proj' }, { folder: 'file:///d%3A/b/proj' }]
      }
    })
    expect(parseVscodeState(dup2, w)).toMatchObject([{ target: 'c:\\a\\proj' }])
  })

  it('UNC 的 file: URI 与中文路径', () => {
    const s = JSON.stringify({
      windowsState: {
        openedWindows: [
          { folder: 'file://server/share/%E8%B3%87%E6%96%99' },
          { folder: 'file:///c%3A/%E4%BD%9C%E6%A5%AD/p' }
        ]
      }
    })
    const r = parseVscodeState(s, [
      win(1, 'a - 資料 - Visual Studio Code'),
      win(2, 'p - Visual Studio Code')
    ])
    expect(r.map((i) => (i.kind === 'vscode' ? i.target : ''))).toEqual([
      '\\\\server\\share\\資料',
      'c:\\作業\\p'
    ])
  })

  it('非法 JSON 抛错；缺 windowsState 为空', () => {
    expect(() => parseVscodeState('oops', [win(1, 'a - p - Visual Studio Code')])).toThrow()
    expect(parseVscodeState('{}', [win(1, 'a - p - Visual Studio Code')])).toEqual([])
  })
})

describe('createVscodeCollector', () => {
  it('读 %APPDATA%\\Code\\User\\globalStorage\\storage.json 并解析', async () => {
    const readFile = vi.fn(async () => storage)
    const c = createVscodeCollector({ readFile, appData: 'C:\\Users\\u\\AppData\\Roaming' })
    const r = await c.collect([win(1, 'a - proj - Visual Studio Code')])
    expect(readFile).toHaveBeenCalledWith(
      'C:\\Users\\u\\AppData\\Roaming\\Code\\User\\globalStorage\\storage.json'
    )
    expect(r).toHaveLength(1)
  })

  it('读文件失败时 reject；没有窗口时不读文件', async () => {
    const bad = createVscodeCollector({
      readFile: async () => {
        throw new Error('ENOENT')
      },
      appData: 'C:\\a'
    })
    await expect(bad.collect([win(1, 'a - p - Visual Studio Code')])).rejects.toThrow('ENOENT')
    const readFile = vi.fn(async () => storage)
    const c = createVscodeCollector({ readFile, appData: 'C:\\a' })
    expect(await c.collect([])).toEqual([])
    expect(readFile).not.toHaveBeenCalled()
  })
})
