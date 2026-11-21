import { describe, expect, it, vi, type Mock } from 'vitest'
import {
  AppError,
  openTargetsOf,
  type DesktopItem,
  type DesktopSnapshotItem,
  type FileStat
} from '@pch/shared'
import { existsViaVfs, restoreItems, type RestoreDeps } from './restore'

const EXPLORER = `${process.env.SystemRoot ?? 'C:\\Windows'}\\explorer.exe`

interface Rec {
  calls: { exe: string; args: string[] }[]
  ps: { script: string; env: Record<string, string>; timeout: number }[]
  sleeps: number[]
  checked: { path: string; timeout: number }[]
}

function makeDeps(
  opts: {
    exists?: (p: string) => 'yes' | 'no' | 'unreachable'
    spawn?: (exe: string, args: string[]) => Promise<void>
    ps?: () => Promise<string>
  } = {}
): { deps: RestoreDeps; rec: Rec; warn: ReturnType<typeof vi.fn> } {
  const rec: Rec = { calls: [], ps: [], sleeps: [], checked: [] }
  const warn = vi.fn()
  const deps: RestoreDeps = {
    spawnDetached: async (exe, args) => {
      rec.calls.push({ exe, args })
      if (opts.spawn) await opts.spawn(exe, args)
    },
    runPowerShell: async (script, env, timeout) => {
      rec.ps.push({ script, env, timeout })
      return opts.ps ? opts.ps() : '0'
    },
    exists: async (path, timeout) => {
      rec.checked.push({ path, timeout })
      return opts.exists ? opts.exists(path) : 'yes'
    },
    sleep: async (ms) => {
      rec.sleeps.push(ms)
    },
    logger: { warn }
  }
  return { deps, rec, warn }
}

const si = (id: number, item: DesktopItem): DesktopSnapshotItem => ({ id, item })
const explorer = (...tabs: string[]): DesktopItem => ({ kind: 'explorer', tabs, bounds: null })
const office = (
  app: 'word' | 'excel' | 'powerpoint',
  path: string,
  exe: string,
  readOnly = false
): DesktopItem => ({ kind: 'office', app, path, readOnly, exe })
const eclipse = (workspace: string, exe = 'C:\\E\\eclipse.exe'): DesktopItem => ({
  kind: 'eclipse',
  workspace,
  exe,
  bounds: null
})
const none = new Set<string>()
const okLines = (n: number): string => 'OK'.concat(String.fromCharCode(10)).repeat(n)
const WORD = 'C:\\O\\WINWORD.EXE'
const CLSID = '::{645FF040-5081-101B-9F08-00AA002F954E}'

describe('restoreItems', () => {
  it('各类项目的 exe 与参数', async () => {
    const { deps, rec } = makeDeps()
    const r = await restoreItems(
      [
        si(1, explorer('C:\\a')),
        si(2, explorer(CLSID)),
        si(3, office('word', 'C:\\d\\a.docx', WORD)),
        si(4, office('excel', 'C:\\d\\b.xlsx', 'C:\\O\\EXCEL.EXE', true)),
        si(5, office('excel', 'C:\\d\\c.xlsx', 'C:\\O\\EXCEL.EXE', false)),
        si(6, office('powerpoint', 'C:\\d\\d.pptx', 'C:\\O\\POWERPNT.EXE', true)),
        si(7, { kind: 'vscode', target: 'C:\\w', exe: 'C:\\V\\Code.exe', bounds: null }),
        si(8, {
          kind: 'vscode',
          target: 'vscode-remote://wsl+x/home/u',
          exe: 'C:\\V\\Code.exe',
          bounds: null
        }),
        si(9, eclipse('C:\\ws'))
      ],
      none,
      deps
    )
    expect(r).toEqual({ launched: 9, skipped: [] })
    expect(rec.calls).toEqual([
      { exe: EXPLORER, args: ['C:\\a'] },
      { exe: EXPLORER, args: ['shell:::{645FF040-5081-101B-9F08-00AA002F954E}'] },
      { exe: WORD, args: ['C:\\d\\a.docx'] },
      { exe: 'C:\\O\\EXCEL.EXE', args: ['/r', 'C:\\d\\b.xlsx'] },
      { exe: 'C:\\O\\EXCEL.EXE', args: ['C:\\d\\c.xlsx'] },
      { exe: 'C:\\O\\POWERPNT.EXE', args: ['C:\\d\\d.pptx'] },
      { exe: 'C:\\V\\Code.exe', args: ['C:\\w'] },
      { exe: 'C:\\V\\Code.exe', args: ['--folder-uri', 'vscode-remote://wsl+x/home/u'] },
      { exe: 'C:\\E\\eclipse.exe', args: ['-data', 'C:\\ws'] }
    ])
    // 项目之间 500 ms（9 项 → 8 次），存在性检查 3000 ms，CLSID 与 vscode-remote 不检查
    expect(rec.sleeps).toEqual(Array(8).fill(500))
    expect(rec.checked.every((c) => c.timeout === 3000)).toBe(true)
    expect(rec.checked.map((c) => c.path)).not.toContain('vscode-remote://wsl+x/home/u')
    expect(rec.checked.some((c) => c.path.startsWith('::'))).toBe(false)
  })

  it('已开着的项目跳过（Explorer 按标签路径，其余按 key）', async () => {
    const { deps, rec } = makeDeps()
    const items = [
      si(1, explorer('C:\\A', 'C:\\b')),
      si(2, office('word', 'C:\\d\\a.docx', WORD)),
      si(3, office('word', 'C:\\d\\x.docx', WORD))
    ]
    const open = openTargetsOf([explorer('c:\\a'), office('word', 'c:\\D\\a.docx', WORD)])
    const r = await restoreItems(items, open, deps)
    expect(r.launched).toBe(1)
    expect(r.skipped).toEqual([
      { itemId: 1, reason: 'open' },
      { itemId: 2, reason: 'open' }
    ])
    expect(rec.calls).toEqual([{ exe: WORD, args: ['C:\\d\\x.docx'] }])
  })

  it('白名单外的 exe 不启动并记 warn；非绝对路径同样拒绝；大小写不敏感', async () => {
    const { deps, rec, warn } = makeDeps()
    const r = await restoreItems(
      [
        si(1, office('word', 'C:\\a.docx', 'C:\\Windows\\System32\\cmd.exe')),
        si(2, { kind: 'vscode', target: 'C:\\w', exe: 'Code.exe', bounds: null }),
        si(3, eclipse('C:\\ws', '')),
        si(4, office('word', 'C:\\b.docx', 'C:\\O\\winword.exe'))
      ],
      none,
      deps
    )
    expect(r.skipped).toEqual([
      { itemId: 1, reason: 'failed' },
      { itemId: 2, reason: 'failed' },
      { itemId: 3, reason: 'failed' }
    ])
    expect(r.launched).toBe(1)
    expect(rec.calls).toEqual([{ exe: 'C:\\O\\winword.exe', args: ['C:\\b.docx'] }])
    expect(warn).toHaveBeenCalledTimes(3)
  })

  it('路径不存在 → missing；连不上 → unreachable，且后续项照常启动', async () => {
    const { deps, rec } = makeDeps({
      exists: (p) => (p.startsWith('\\\\srv') ? 'unreachable' : p.includes('gone') ? 'no' : 'yes')
    })
    const r = await restoreItems(
      [
        si(1, office('word', '\\\\srv\\share\\a.docx', WORD)),
        si(2, office('word', 'C:\\gone.docx', WORD)),
        si(3, office('word', 'C:\\ok.docx', WORD)),
        si(4, eclipse('C:\\gone-ws'))
      ],
      none,
      deps
    )
    expect(r.skipped).toEqual([
      { itemId: 1, reason: 'unreachable' },
      { itemId: 2, reason: 'missing' },
      { itemId: 4, reason: 'missing' }
    ])
    expect(r.launched).toBe(1)
    expect(rec.calls).toEqual([{ exe: WORD, args: ['C:\\ok.docx'] }])
  })

  it('stat 超时的项目跳过且不阻塞后续（总时长不随失败项累加）', async () => {
    vi.useFakeTimers()
    try {
      const { deps, rec } = makeDeps()
      deps.sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
      // 真实 exists 由 Task 10 组装；这里用「timeoutMs 后给出 unreachable」模拟连不上的网络路径
      deps.exists = (p, t) =>
        p.startsWith('\\\\')
          ? new Promise((resolve) => setTimeout(() => resolve('unreachable'), t))
          : Promise.resolve('yes')
      const run = restoreItems(
        [
          si(1, office('word', '\\\\a\\x.docx', WORD)),
          si(2, office('word', '\\\\b\\x.docx', WORD)),
          si(3, eclipse('C:\\ws'))
        ],
        none,
        deps
      )
      // 两个失败项各 3000 + 间隔 500，之后的 Eclipse 照常启动
      await vi.advanceTimersByTimeAsync(3000 + 500 + 3000 + 500 + 10)
      const r = await run
      expect(r.skipped).toEqual([
        { itemId: 1, reason: 'unreachable' },
        { itemId: 2, reason: 'unreachable' }
      ])
      expect(rec.calls).toEqual([{ exe: 'C:\\E\\eclipse.exe', args: ['-data', 'C:\\ws'] }])
    } finally {
      vi.useRealTimers()
    }
  })

  it('Explorer 有标签不存在时只恢复其余标签；全部不存在才跳过', async () => {
    const { deps, rec } = makeDeps({ exists: (p) => (p.includes('gone') ? 'no' : 'yes') })
    const r = await restoreItems(
      [si(1, explorer('C:\\gone1', 'C:\\ok')), si(2, explorer('C:\\gone2', 'C:\\gone3'))],
      none,
      deps
    )
    expect(r.launched).toBe(1)
    expect(r.skipped).toEqual([{ itemId: 2, reason: 'missing' }])
    expect(rec.calls).toEqual([{ exe: EXPLORER, args: ['C:\\ok'] }])
    expect(rec.ps).toHaveLength(0)
  })

  it('Explorer 全部标签连不上 → unreachable', async () => {
    const { deps } = makeDeps({ exists: (p) => (p.includes('gone') ? 'no' : 'unreachable') })
    const r = await restoreItems([si(1, explorer('C:\\gone', '\\\\srv\\s'))], none, deps)
    expect(r.skipped).toEqual([{ itemId: 1, reason: 'unreachable' }])
  })

  it('Explorer 多标签：整体交给脚本（路径经 PCH_TABS），上限 15 + 5×(n-1) 秒，不再 spawn', async () => {
    const { deps, rec } = makeDeps({ ps: async () => okLines(3) })
    const tabs = ['C:\\a', CLSID, 'C:\\c']
    const r = await restoreItems([si(1, explorer(...tabs))], none, deps)
    expect(r).toEqual({ launched: 1, skipped: [] })
    expect(rec.calls).toHaveLength(0)
    expect(rec.ps).toHaveLength(1)
    expect(rec.ps[0]?.timeout).toBe(25_000)
    expect(JSON.parse(rec.ps[0]?.env.PCH_TABS ?? '')).toEqual(tabs)
  })

  it('Explorer 脚本只恢复了部分标签 → 其余逐个 explorer.exe', async () => {
    const { deps, rec } = makeDeps({ ps: async () => okLines(1) })
    const clsid2 = '::{20D04FE0-3AEA-1069-A2D8-08002B30309D}'
    await restoreItems([si(1, explorer('C:\\a', 'C:\\b', clsid2))], none, deps)
    expect(rec.calls).toEqual([
      { exe: EXPLORER, args: ['C:\\b'] },
      { exe: EXPLORER, args: ['shell:::{20D04FE0-3AEA-1069-A2D8-08002B30309D}'] }
    ])
  })

  it('Explorer 脚本失败 / 超时 → 全部逐个 explorer.exe，项目计为已启动', async () => {
    const { deps, rec, warn } = makeDeps({
      ps: async () => {
        throw new Error('timeout')
      }
    })
    const r = await restoreItems([si(1, explorer('C:\\a', 'C:\\b'))], none, deps)
    expect(r).toEqual({ launched: 1, skipped: [] })
    expect(rec.calls).toEqual([
      { exe: EXPLORER, args: ['C:\\a'] },
      { exe: EXPLORER, args: ['C:\\b'] }
    ])
    expect(warn).toHaveBeenCalled()
  })

  it('Explorer 脚本超时但已输出进度 → 只续开剩余标签', async () => {
    const { deps, rec } = makeDeps({
      ps: async () => {
        throw Object.assign(new Error('timeout'), { stdout: 'OK\r\nOK\r\n' })
      }
    })
    const r = await restoreItems([si(1, explorer('C:\\a', 'C:\\b', 'C:\\c', 'C:\\d'))], none, deps)
    expect(r).toEqual({ launched: 1, skipped: [] })
    expect(rec.calls).toEqual([
      { exe: EXPLORER, args: ['C:\\c'] },
      { exe: EXPLORER, args: ['C:\\d'] }
    ])
  })

  it('Explorer 脚本全部完成后才失败（stdout 有全部进度）→ 不再启动任何东西', async () => {
    const { deps, rec } = makeDeps({
      ps: async () => {
        throw Object.assign(new Error('exit 1'), { stdout: 'OK\nOK\n' })
      }
    })
    await restoreItems([si(1, explorer('C:\\a', 'C:\\b'))], none, deps)
    expect(rec.calls).toHaveLength(0)
  })

  it('Explorer 脚本输出为空或乱码 → 视为 0 个，全部逐个 explorer.exe', async () => {
    for (const out of ['', '###\n??', '3']) {
      const { deps, rec } = makeDeps({ ps: async () => out })
      await restoreItems([si(1, explorer('C:\\a', 'C:\\b'))], none, deps)
      expect(rec.calls).toHaveLength(2)
    }
  })

  it('非绝对路径、以 - 开头的 VS Code target、非严格 CLSID 一律 failed', async () => {
    const { deps, rec } = makeDeps()
    const r = await restoreItems(
      [
        si(1, office('word', 'a.docx', WORD)),
        si(2, {
          kind: 'vscode',
          target: '--user-data-dir=x',
          exe: 'C:\\V\\Code.exe',
          bounds: null
        }),
        si(3, { kind: 'vscode', target: 'rel\\dir', exe: 'C:\\V\\Code.exe', bounds: null }),
        si(4, eclipse('ws')),
        si(5, explorer('::{not-a-clsid}')),
        si(6, explorer('docs'))
      ],
      none,
      deps
    )
    expect(r.launched).toBe(0)
    expect(r.skipped.map((s) => s.reason)).toEqual(Array(6).fill('failed'))
    expect(rec.calls).toHaveLength(0)
  })

  it('Explorer 多标签的存在性检查并行进行', async () => {
    vi.useFakeTimers()
    try {
      const { deps } = makeDeps({ ps: async () => okLines(3) })
      deps.exists = (_p, t) => new Promise((resolve) => setTimeout(() => resolve('yes'), t))
      const unc = (n: string): string => `\\\\${n}\\x`
      const run = restoreItems([si(1, explorer(unc('a'), unc('b'), unc('c')))], none, deps)
      await vi.advanceTimersByTimeAsync(3000 + 10)
      expect(await run).toEqual({ launched: 1, skipped: [] })
    } finally {
      vi.useRealTimers()
    }
  })

  it('启动抛错计入 failed，后续继续', async () => {
    const { deps, rec } = makeDeps({
      spawn: async (exe) => {
        if (exe.endsWith('EXCEL.EXE')) throw new Error('spawn ENOENT')
      }
    })
    const r = await restoreItems(
      [
        si(1, office('excel', 'C:\\a.xlsx', 'C:\\O\\EXCEL.EXE')),
        si(2, office('word', 'C:\\b.docx', WORD))
      ],
      none,
      deps
    )
    expect(r).toEqual({ launched: 1, skipped: [{ itemId: 1, reason: 'failed' }] })
    expect(rec.calls).toHaveLength(2)
  })
})

describe('existsViaVfs', () => {
  const stat: FileStat = {
    uri: 'file:///C:/work',
    name: 'work',
    kind: 'directory',
    size: 0,
    mtime: 0
  }
  type StatFn = (uri: string, requestId?: string) => Promise<FileStat>
  const failing = (
    code: 'FS_NOT_FOUND' | 'FS_UNAVAILABLE' | 'UNKNOWN'
  ): { stat: Mock<StatFn>; cancel: Mock<(requestId: string) => void> } => ({
    stat: vi.fn<StatFn>(() => Promise.reject(new AppError({ code }))),
    cancel: vi.fn<(requestId: string) => void>()
  })

  it('stat 成功 → yes，参数为 file URI', async () => {
    const vfs = { stat: vi.fn(async () => stat), cancel: vi.fn() }
    expect(await existsViaVfs(vfs)('C:\\work', 3000)).toBe('yes')
    expect(vfs.stat.mock.calls[0]).toEqual(['file:///C:/work', expect.any(String)])
  })

  it('FS_NOT_FOUND → no；FS_UNAVAILABLE / 其他错误 / 非绝对路径 → unreachable', async () => {
    expect(await existsViaVfs(failing('FS_NOT_FOUND'))('C:\\x', 3000)).toBe('no')
    expect(await existsViaVfs(failing('FS_UNAVAILABLE'))('\\\\nas\\s\\x', 3000)).toBe('unreachable')
    expect(await existsViaVfs(failing('UNKNOWN'))('C:\\x', 3000)).toBe('unreachable')
    const relative = failing('UNKNOWN')
    expect(await existsViaVfs(relative)('relative', 3000)).toBe('unreachable')
    expect(relative.stat).not.toHaveBeenCalled()
  })

  it('超时 → unreachable，并取消该次 stat', async () => {
    vi.useFakeTimers()
    try {
      const vfs = {
        stat: vi.fn<StatFn>(() => new Promise<FileStat>(() => undefined)),
        cancel: vi.fn()
      }
      const r = existsViaVfs(vfs)('\\\\nas\\s\\x', 3000)
      await vi.advanceTimersByTimeAsync(2999)
      expect(vfs.cancel).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(1)
      expect(await r).toBe('unreachable')
      expect(vfs.cancel).toHaveBeenCalledWith(vfs.stat.mock.calls[0]![1])
    } finally {
      vi.useRealTimers()
    }
  })
})
