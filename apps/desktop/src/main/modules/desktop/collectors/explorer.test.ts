import { describe, expect, it, vi } from 'vitest'
import type { WindowInfo } from '../window-list'
import { createExplorerCollector, parseExplorerOutput } from './explorer'

const bounds = { x: 10, y: 20, width: 800, height: 600 }
const win = (hwnd: number): WindowInfo => ({
  hwnd,
  pid: 1,
  exe: 'C:\\Windows\\explorer.exe',
  className: 'CabinetWClass',
  title: 't',
  bounds
})

describe('parseExplorerOutput', () => {
  it('保留标签顺序并补上 bounds（含 CLSID 与日文路径）', () => {
    const tabs = ['C:\\Windows', '::{645FF040-5081-101B-9F08-00AA002F954E}', 'D:\\資料\\日報']
    const out = JSON.stringify([{ hwnd: 100, tabs }])
    expect(parseExplorerOutput(out, [win(100)])).toEqual([{ kind: 'explorer', tabs, bounds }])
  })

  it('同一 hwnd 的多项合并为一项且顺序保留', () => {
    const out = JSON.stringify([
      { hwnd: 100, tabs: ['C:\\a'] },
      { hwnd: 100, tabs: ['C:\\b'] }
    ])
    const r = parseExplorerOutput(out, [win(100)])
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({ tabs: ['C:\\a', 'C:\\b'] })
  })

  it('hwnd 不在 windows 中的项丢弃', () => {
    const out = JSON.stringify([
      { hwnd: 999, tabs: ['C:\\x'] },
      { hwnd: 100, tabs: ['C:\\a'] }
    ])
    expect(parseExplorerOutput(out, [win(100)])).toHaveLength(1)
  })

  it('接受单个对象与空输出，非法 JSON 抛错', () => {
    expect(parseExplorerOutput('{"hwnd":100,"tabs":"C:\\\\a"}', [win(100)])).toHaveLength(1)
    expect(parseExplorerOutput('  \r\n', [win(100)])).toEqual([])
    expect(() => parseExplorerOutput('not json', [win(100)])).toThrow()
  })
})

describe('createExplorerCollector', () => {
  it('把窗口句柄经环境变量传入固定脚本', async () => {
    const run = vi.fn().mockResolvedValue('[{"hwnd":100,"tabs":["C:\\\\a"]}]')
    const items = await createExplorerCollector(run, 1000).collect([win(100), win(200)])
    expect(run).toHaveBeenCalledWith(expect.any(String), { PCH_HWNDS: '100,200' }, 1000)
    expect(items).toHaveLength(1)
  })

  it('run reject 时 reject', async () => {
    const run = vi.fn().mockRejectedValue(new Error('timeout'))
    await expect(createExplorerCollector(run, 1000).collect([win(1)])).rejects.toThrow('timeout')
  })
})
