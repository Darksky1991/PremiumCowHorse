import { describe, expect, it, vi } from 'vitest'
import type { WindowInfo } from '../window-list'
import { createEclipseCollector, parseEclipseWorkspace } from './eclipse'

// 样例按 Eclipse 官方格式构造（本机未安装 Eclipse，未实机验证）
const prefs =
  '#Wed Nov 12 10:00:00 JST 2026\neclipse.preferences.version=1\n' +
  'RECENT_WORKSPACES=C\\:\\\\Users\\\\x\\\\ws one\\nD\\:\\\\old\n' +
  'SHOW_WORKSPACE_SELECTION_DIALOG=true\n'

describe('parseEclipseWorkspace', () => {
  it('-data 带引号与不带引号', () => {
    expect(
      parseEclipseWorkspace('"C:\\e\\eclipse.exe" -data "C:\\ws a" -vmargs -Xmx2g', null)
    ).toBe('C:\\ws a')
    expect(parseEclipseWorkspace('C:\\e\\eclipse.exe -data C:\\ws -showsplash', prefs)).toBe(
      'C:\\ws'
    )
  })

  it('没有 -data 时取 prefs 的 RECENT_WORKSPACES 第一项（Java properties 转义还原）', () => {
    expect(parseEclipseWorkspace('"C:\\e\\eclipse.exe"', prefs)).toBe('C:\\Users\\x\\ws one')
    expect(parseEclipseWorkspace(null, prefs)).toBe('C:\\Users\\x\\ws one')
  })

  it('都没有时为 null；@noDefault 等占位不当作路径', () => {
    expect(parseEclipseWorkspace(null, null)).toBeNull()
    expect(parseEclipseWorkspace('eclipse.exe', 'a=b\n')).toBeNull()
    expect(parseEclipseWorkspace('eclipse.exe -data @noDefault', null)).toBeNull()
    expect(parseEclipseWorkspace('eclipse.exe -data -vmargs -Xmx2g', null)).toBeNull()
  })
})

const win = (hwnd: number, pid: number, exe: string, w = 100): WindowInfo => ({
  hwnd,
  pid,
  exe,
  className: 'SWT_Window0',
  title: 't',
  bounds: { x: 0, y: 0, width: w, height: w }
})

describe('createEclipseCollector', () => {
  it('每个进程一项：-data 优先，缺省时读 exe 旁 configuration/.settings 的 prefs', async () => {
    const readFile = vi.fn(async () => prefs)
    const commandLineOf = vi.fn(async (pid: number) =>
      pid === 1 ? '"C:\\e\\eclipse.exe" -data C:\\ws1' : '"C:\\f\\eclipse.exe"'
    )
    const c = createEclipseCollector({ readFile, commandLineOf })
    const r = await c.collect([
      win(10, 1, 'C:\\e\\eclipse.exe'),
      win(11, 1, 'C:\\e\\eclipse.exe', 500),
      win(20, 2, 'C:\\f\\eclipse.exe')
    ])
    expect(r).toEqual([
      {
        kind: 'eclipse',
        workspace: 'C:\\ws1',
        exe: 'C:\\e\\eclipse.exe',
        bounds: { x: 0, y: 0, width: 500, height: 500 }
      },
      {
        kind: 'eclipse',
        workspace: 'C:\\Users\\x\\ws one',
        exe: 'C:\\f\\eclipse.exe',
        bounds: { x: 0, y: 0, width: 100, height: 100 }
      }
    ])
    expect(readFile).toHaveBeenCalledTimes(1)
    expect(readFile).toHaveBeenCalledWith(
      'C:\\f\\configuration\\.settings\\org.eclipse.ui.ide.prefs'
    )
  })

  it('prefs 不存在按没有处理；取不到工作区的进程忽略；同一 workspace 只一项', async () => {
    const c = createEclipseCollector({
      readFile: async () => {
        throw new Error('ENOENT')
      },
      commandLineOf: async (pid) => (pid === 3 ? null : pid === 1 ? 'e -data C:\\w' : 'e')
    })
    const r = await c.collect([
      win(1, 1, 'C:\\e\\eclipse.exe'),
      win(2, 2, 'C:\\e\\eclipse.exe'),
      win(3, 3, 'C:\\e\\eclipse.exe')
    ])
    expect(r).toHaveLength(1)
  })

  it('-data 的正斜杠绝对路径统一成反斜杠（恢复只接受 X:\\ 与 UNC）；相对路径原样', async () => {
    const c = createEclipseCollector({
      readFile: async () => '',
      commandLineOf: async (pid) => (pid === 1 ? 'e -data C:/work/ws' : 'e -data rel/ws')
    })
    const r = await c.collect([win(1, 1, 'C:\\e\\eclipse.exe'), win(2, 2, 'C:\\e\\eclipse.exe')])
    expect(r.map((i) => (i.kind === 'eclipse' ? i.workspace : ''))).toEqual([
      'C:\\work\\ws',
      'rel/ws'
    ])
  })

  it('commandLineOf 失败时 reject；没有窗口返回空', async () => {
    const c = createEclipseCollector({
      readFile: async () => '',
      commandLineOf: async () => {
        throw new Error('timeout')
      }
    })
    await expect(c.collect([win(1, 1, 'C:\\e\\eclipse.exe')])).rejects.toThrow('timeout')
    expect(await c.collect([])).toEqual([])
  })
})
