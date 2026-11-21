import { tmpdir } from 'node:os'
import { describe, expect, it, vi } from 'vitest'
import type { WindowInfo } from '../window-list'
import { createOfficeCollector, parseOfficeOutput } from './office'

const bounds = { x: 0, y: 0, width: 1, height: 1 }
const win = (hwnd: number, pid: number, exe: string): WindowInfo => ({
  hwnd,
  pid,
  exe,
  className: 'XLMAIN',
  title: 't',
  bounds
})
const windows = [win(456, 7, 'C:\\o\\EXCEL.EXE'), win(457, 8, 'C:\\o\\WINWORD.EXE')]

describe('parseOfficeOutput', () => {
  it('取窗口的 exe 与只读状态', () => {
    const out = JSON.stringify([
      { app: 'excel', path: 'C:\\docs\\book-b.xlsx', readOnly: true, hwnd: 456 },
      { app: 'word', path: 'D:\\資料\\doc-a.docx', readOnly: false, hwnd: 457 }
    ])
    expect(parseOfficeOutput(out, windows)).toEqual([
      {
        kind: 'office',
        app: 'excel',
        path: 'C:\\docs\\book-b.xlsx',
        readOnly: true,
        exe: 'C:\\o\\EXCEL.EXE'
      },
      {
        kind: 'office',
        app: 'word',
        path: 'D:\\資料\\doc-a.docx',
        readOnly: false,
        exe: 'C:\\o\\WINWORD.EXE'
      }
    ])
  })

  it('丢弃 https:// 与临时目录中的文档，窗口不存在的项也丢弃', () => {
    const out = JSON.stringify([
      { app: 'excel', path: 'https://example.sharepoint.com/a.xlsx', readOnly: false, hwnd: 456 },
      { app: 'excel', path: `${tmpdir()}\\mail\\a.xlsx`, readOnly: false, hwnd: 456 },
      { app: 'excel', path: 'C:\\docs\\keep.xlsx', readOnly: false, hwnd: 456 },
      { app: 'excel', path: 'C:\\docs\\ghost.xlsx', readOnly: false, hwnd: 1 }
    ])
    const r = parseOfficeOutput(out, windows)
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({ path: 'C:\\docs\\keep.xlsx' })
  })

  it('错误标记与非法 JSON 抛错；空输出为空', () => {
    expect(() => parseOfficeOutput('{"error":"busy"}', windows)).toThrow('busy')
    expect(() => parseOfficeOutput('oops', windows)).toThrow()
    expect(parseOfficeOutput('', windows)).toEqual([])
  })

  it('程序开着但没有文档（脚本输出空或空数组）时返回空而不是抛错', () => {
    expect(parseOfficeOutput('[]', windows)).toEqual([])
    expect(parseOfficeOutput('\r\n', windows)).toEqual([])
  })
})

describe('createOfficeCollector', () => {
  it('按 pid 去重经环境变量传入', async () => {
    const run = vi.fn().mockResolvedValue('')
    await createOfficeCollector(run, 500).collect([...windows, win(458, 7, 'C:\\o\\EXCEL.EXE')])
    expect(run).toHaveBeenCalledWith(expect.any(String), { PCH_PIDS: '7,8' }, 500)
  })

  it('run reject 时 reject', async () => {
    const run = vi.fn().mockRejectedValue(new Error('boom'))
    await expect(createOfficeCollector(run, 500).collect(windows)).rejects.toThrow('boom')
  })
})
