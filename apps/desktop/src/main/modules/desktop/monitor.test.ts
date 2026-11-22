import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DesktopCollector, DesktopItem } from '@pch/shared'
import type { Collector } from './collectors/types'
import { LiveState } from './live-state'
import { DesktopMonitor, type MonitorTimings } from './monitor'
import type { WindowInfo } from './window-list'

const timings: MonitorTimings = {
  pollMs: 5000,
  debounceMs: 2000,
  debounceOverrides: { vscode: 10_000 },
  fullRefreshMs: 300_000,
  collectorTimeoutMs: 10_000
}
const bounds = { x: 0, y: 0, width: 1, height: 1 }
const win = (hwnd: number, exe: string, className: string, title: string): WindowInfo => ({
  hwnd,
  pid: hwnd,
  exe: `C:\\x\\${exe}`,
  className,
  title,
  bounds
})
const word = (hwnd: number, title = 'a.docx - Word'): WindowInfo =>
  win(hwnd, 'WINWORD.EXE', 'OpusApp', title)
const code = (hwnd: number, title: string): WindowInfo =>
  win(hwnd, 'Code.exe', 'Chrome_WidgetWin_1', title)
const doc = (path: string): DesktopItem => ({
  kind: 'office',
  app: 'word',
  path,
  readOnly: false,
  exe: 'WINWORD.EXE'
})

const IDS = ['explorer', 'office', 'vscode', 'eclipse'] as const

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- 测试夹具，返回类型由推断得出
function setup() {
  let windows: WindowInfo[] = []
  let listError: Error | null = null
  const handlers: Partial<Record<DesktopCollector, (ws: WindowInfo[]) => Promise<DesktopItem[]>>> =
    {}
  const calls: Record<DesktopCollector, WindowInfo[][]> = {
    explorer: [],
    office: [],
    vscode: [],
    eclipse: []
  }
  const collectors: Collector[] = IDS.map((id) => ({
    id,
    collect: (ws) => {
      calls[id]!.push(ws)
      return (handlers[id] ?? (() => Promise.resolve([])))(ws)
    }
  }))
  const live = new LiveState({ removeAfterMs: 60_000 })
  const logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }
  const onChange = vi.fn()
  const m = new DesktopMonitor({
    listWindows: () => {
      if (listError) throw listError
      return windows
    },
    collectors,
    live,
    timings,
    now: () => Date.now(),
    logger,
    onChange
  })
  return {
    m,
    live,
    logger,
    onChange,
    calls,
    handlers,
    setWindows: (w: WindowInfo[]) => (windows = w),
    setListError: (e: Error | null) => (listError = e)
  }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('DesktopMonitor', () => {
  it('标题变化只触发该类采集，防抖内多次变化合并为一次', async () => {
    const t = setup()
    t.setWindows([word(1)])
    t.m.start()
    await vi.advanceTimersByTimeAsync(5000) // 首次发现
    await vi.advanceTimersByTimeAsync(2000)
    expect(t.calls.office).toHaveLength(1)
    expect(t.calls.explorer).toHaveLength(0)
    // 两次变化发生在同一个 poll 间隔内：合并为一次采集，取最新标题
    t.setWindows([word(1, 'b - Word')])
    t.setWindows([word(1, 'c - Word')])
    await vi.advanceTimersByTimeAsync(3000 + 1999)
    expect(t.calls.office).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(t.calls.office).toHaveLength(2)
    expect(t.calls.office[1]![0]!.title).toBe('c - Word')
    t.m.stop()
  })

  it('采集器只收到属于该类的窗口', async () => {
    const t = setup()
    t.setWindows([word(1), code(2, 'x - Code'), win(3, 'notepad.exe', 'Notepad', 'n')])
    t.m.start()
    await vi.advanceTimersByTimeAsync(5000 + 10_000)
    expect(t.calls.office[0]!.map((w) => w.hwnd)).toEqual([1])
    expect(t.calls.vscode[0]!.map((w) => w.hwnd)).toEqual([2])
    t.m.stop()
  })

  it('vscode 标题变化 10 秒后才采集', async () => {
    const t = setup()
    t.setWindows([code(2, 'a - Code')])
    t.m.start()
    await vi.advanceTimersByTimeAsync(5000)
    await vi.advanceTimersByTimeAsync(9999)
    expect(t.calls.vscode).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(1)
    expect(t.calls.vscode).toHaveLength(1)
    t.m.stop()
  })

  it('某类窗口全部消失也触发一次采集', async () => {
    const t = setup()
    t.handlers.office = (ws) => Promise.resolve(ws.length ? [doc('C:\\a.docx')] : [])
    t.setWindows([word(1)])
    t.m.start()
    await vi.advanceTimersByTimeAsync(7000)
    expect(t.live.current()).toHaveLength(1)
    t.setWindows([])
    await vi.advanceTimersByTimeAsync(5000 + 2000)
    expect(t.calls.office).toHaveLength(2)
    expect(t.calls.office[1]).toEqual([])
    expect(t.live.current()).toHaveLength(0)
    t.m.stop()
  })

  it('fullRefreshMs 到时全部类别采集', async () => {
    const t = setup()
    t.m.start()
    await vi.advanceTimersByTimeAsync(300_000)
    for (const id of IDS) expect(t.calls[id]).toHaveLength(1)
    t.m.stop()
  })

  it('采集器失败时保留该类上一次结果，不开始计时移除', async () => {
    const t = setup()
    t.handlers.office = () => Promise.resolve([doc('C:\\a.docx')])
    await t.m.refreshAll()
    t.handlers.office = () => Promise.reject(new Error('modal dialog'))
    // 采集器失败不影响返回值：枚举成功即为 true
    expect(await t.m.refreshAll()).toBe(true)
    expect(t.live.current()).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(120_000)
    expect(t.live.retained(Date.now())).toHaveLength(1)
  })

  it('连续失败只记一次日志并报告状态，成功后移出并记 info', async () => {
    const t = setup()
    t.handlers.office = () => Promise.reject(new Error('blocked by policy\nstdout: long...'))
    await t.m.refreshAll()
    await t.m.refreshAll()
    await t.m.refreshAll()
    expect(t.logger.warn).toHaveBeenCalledTimes(1)
    const msg = String(t.logger.warn.mock.calls[0]![0])
    expect(msg).toContain('blocked by policy')
    expect(msg).not.toContain('stdout')
    expect(t.m.unreadable()).toEqual(['office'])
    expect(t.onChange).toHaveBeenCalledTimes(1) // 集合变化一次
    t.handlers.office = () => Promise.resolve([])
    await t.m.refreshAll()
    expect(t.m.unreadable()).toEqual([])
    expect(t.logger.info).toHaveBeenCalledTimes(1)
    expect(t.onChange).toHaveBeenCalledTimes(2)
  })

  it('超时按失败处理，迟到的结果丢弃', async () => {
    const t = setup()
    let resolveLate!: (v: DesktopItem[]) => void
    t.handlers.office = () => new Promise((r) => (resolveLate = r))
    const p = t.m.refreshAll()
    await vi.advanceTimersByTimeAsync(10_000)
    await p
    expect(t.m.unreadable()).toEqual(['office'])
    resolveLate([doc('C:\\late.docx')])
    await vi.advanceTimersByTimeAsync(0)
    expect(t.live.current()).toHaveLength(0)
  })

  it('全部窗口同一轮消失后 retained 不变，60 秒后才清空', async () => {
    const t = setup()
    t.handlers.office = (ws) =>
      Promise.resolve(ws.length ? [doc('C:\\a.docx'), doc('C:\\b.docx')] : [])
    t.setWindows([word(1)])
    t.m.start()
    await vi.advanceTimersByTimeAsync(7000)
    t.setWindows([])
    await vi.advanceTimersByTimeAsync(5000 + 2000)
    const gone = Date.now()
    expect(t.live.retained(gone)).toHaveLength(2)
    expect(t.live.retained(gone + 50_000)).toHaveLength(2)
    expect(t.live.retained(gone + 70_000)).toHaveLength(0)
    t.m.stop()
  })

  it('同一类别采集进行中又有变化，结束后补一次', async () => {
    const t = setup()
    const gates: (() => void)[] = []
    t.handlers.office = () => new Promise<DesktopItem[]>((r) => gates.push(() => r([])))
    t.setWindows([word(1)])
    t.m.start()
    await vi.advanceTimersByTimeAsync(7000) // 第一次采集进行中
    t.setWindows([word(1, 'b - Word')])
    await vi.advanceTimersByTimeAsync(5000 + 2000) // 超时前（<10s）又触发
    expect(t.calls.office).toHaveLength(1)
    gates[0]!()
    await vi.advanceTimersByTimeAsync(0)
    expect(t.calls.office).toHaveLength(2)
    gates[1]!()
    await vi.advanceTimersByTimeAsync(0)
    t.m.stop()
  })

  it('枚举抛错只记一次 warn，下一轮照常', async () => {
    const t = setup()
    t.setListError(new Error('koffi boom'))
    t.m.start()
    await vi.advanceTimersByTimeAsync(15_000)
    expect(t.logger.warn).toHaveBeenCalledTimes(1)
    t.setListError(null)
    t.setWindows([word(1)])
    await vi.advanceTimersByTimeAsync(5000 + 2000)
    expect(t.calls.office).toHaveLength(1)
    t.m.stop()
  })

  it('onChange 只在 apply 返回 true 时调用', async () => {
    const t = setup()
    t.handlers.office = () => Promise.resolve([doc('C:\\a.docx')])
    await t.m.refreshAll()
    expect(t.onChange).toHaveBeenCalledTimes(1)
    await t.m.refreshAll()
    expect(t.onChange).toHaveBeenCalledTimes(1)
  })

  it('stop() 后假时钟前进不再采集、不再回调', async () => {
    const t = setup()
    t.setWindows([word(1)])
    t.m.start()
    await vi.advanceTimersByTimeAsync(5000) // 防抖已排队
    t.m.stop()
    await vi.advanceTimersByTimeAsync(600_000)
    for (const id of IDS) expect(t.calls[id]).toHaveLength(0)
    expect(t.onChange).not.toHaveBeenCalled()
  })

  it('vscode 标题每 5 秒变一次：从第一次变化起 10 秒后采集，之后的变化再排一次', async () => {
    const t = setup()
    t.setWindows([code(2, 'a')])
    t.m.start()
    await vi.advanceTimersByTimeAsync(5000) // 发现，防抖开始（到 15000）
    t.setWindows([code(2, 'b')])
    await vi.advanceTimersByTimeAsync(5000) // t=10000，变化不重置
    t.setWindows([code(2, 'c')])
    await vi.advanceTimersByTimeAsync(4999)
    expect(t.calls.vscode).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(1) // t=15000
    expect(t.calls.vscode).toHaveLength(1)
    expect(t.calls.vscode[0]![0]!.title).toBe('b') // 最近一次枚举的结果
    t.setWindows([code(2, 'd')])
    await vi.advanceTimersByTimeAsync(5000 + 10_000)
    expect(t.calls.vscode).toHaveLength(2)
    t.m.stop()
  })

  it('refreshAll 时枚举抛错：不调用任何采集器，已有项目不受影响', async () => {
    const t = setup()
    t.handlers.office = () => Promise.resolve([doc('C:\\a.docx')])
    expect(await t.m.refreshAll()).toBe(true)
    t.setListError(new Error('koffi boom'))
    t.handlers.office = () => Promise.resolve([])
    // 枚举失败：返回 false（调用方据此不把这一轮当作完整读取）
    expect(await t.m.refreshAll()).toBe(false)
    expect(t.calls.office).toHaveLength(1)
    expect(t.m.unreadable()).toEqual([])
    expect(t.live.current()).toHaveLength(1)
  })

  it('fullRefresh 取消已排队的防抖，不重复采集', async () => {
    const t = setup()
    t.setWindows([code(2, 'a')])
    t.m.start()
    await vi.advanceTimersByTimeAsync(294_000)
    expect(t.calls.vscode).toHaveLength(1)
    t.setWindows([code(2, 'b')])
    await vi.advanceTimersByTimeAsync(2000) // 295000 发现变化，防抖排到 305000
    await vi.advanceTimersByTimeAsync(4000) // 300000 fullRefresh 取消防抖并采集
    expect(t.calls.vscode).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(6000)
    expect(t.calls.vscode).toHaveLength(2)
    t.m.stop()
  })

  it('超时后同类别下次仍会采集', async () => {
    const t = setup()
    t.handlers.office = () => new Promise(() => {})
    const p = t.m.refreshAll()
    await vi.advanceTimersByTimeAsync(10_000)
    await p
    t.handlers.office = () => Promise.resolve([doc('C:\\a.docx')])
    await t.m.refreshAll()
    expect(t.calls.office).toHaveLength(2)
    expect(t.m.unreadable()).toEqual([])
    expect(t.live.current()).toHaveLength(1)
  })

  it('stop 时进行中的采集完成后不 apply、不回调', async () => {
    const t = setup()
    let finish!: (v: DesktopItem[]) => void
    t.handlers.office = () => new Promise((r) => (finish = r))
    void t.m.refreshAll()
    await vi.advanceTimersByTimeAsync(0)
    t.m.stop()
    finish([doc('C:\\a.docx')])
    await vi.advanceTimersByTimeAsync(0)
    expect(t.live.current()).toHaveLength(0)
    expect(t.onChange).not.toHaveBeenCalled()
  })
})
