import { describe, expect, it } from 'vitest'
import { collectorOf, windowsSignature, type WindowInfo } from './window-list'

const bounds = { x: 0, y: 0, width: 100, height: 100 }
const win = (exe: string, className: string, title = 't', hwnd = 1): WindowInfo => ({
  hwnd,
  pid: 1,
  exe,
  className,
  title,
  bounds
})

describe('collectorOf', () => {
  it('按 exe 文件名与窗口类判断类别', () => {
    expect(collectorOf(win('C:\\Windows\\explorer.exe', 'CabinetWClass'))).toBe('explorer')
    expect(collectorOf(win('C:\\o\\WINWORD.EXE', 'OpusApp'))).toBe('office')
    expect(collectorOf(win('C:\\o\\EXCEL.EXE', 'XLMAIN'))).toBe('office')
    expect(collectorOf(win('C:\\o\\POWERPNT.EXE', 'PPTFrameClass'))).toBe('office')
    expect(collectorOf(win('C:\\v\\Code.exe', 'Chrome_WidgetWin_1'))).toBe('vscode')
    expect(collectorOf(win('C:\\e\\eclipse.exe', 'SWT_Window0'))).toBe('eclipse')
  })

  it('exe 文件名不区分大小写', () => {
    expect(collectorOf(win('C:\\o\\excel.exe', 'XLMAIN'))).toBe('office')
    expect(collectorOf(win('C:\\Windows\\EXPLORER.EXE', 'CabinetWClass'))).toBe('explorer')
  })

  it('其他程序、类名不符、无法读取 exe 时为 null', () => {
    expect(collectorOf(win('C:\\Windows\\notepad.exe', 'Notepad'))).toBeNull()
    expect(collectorOf(win('C:\\Windows\\explorer.exe', 'Shell_TrayWnd'))).toBeNull()
    expect(collectorOf(win('', 'CabinetWClass'))).toBeNull()
  })

  it('标题为空的 Code.exe 为 null', () => {
    expect(collectorOf(win('C:\\v\\Code.exe', 'Chrome_WidgetWin_1', ''))).toBeNull()
  })
})

describe('windowsSignature', () => {
  const base = [
    win('C:\\Windows\\explorer.exe', 'CabinetWClass', 'A', 2),
    win('C:\\o\\EXCEL.EXE', 'XLMAIN', 'Book1', 1),
    win('C:\\Windows\\notepad.exe', 'Notepad', 'memo', 3)
  ]

  it('只含有类别的窗口', () => {
    expect([...windowsSignature(base).keys()].sort()).toEqual(['explorer', 'office'])
  })

  it('只改某一类的标题时只有该类的串变化', () => {
    const before = windowsSignature(base)
    const after = windowsSignature(base.map((w) => (w.hwnd === 2 ? { ...w, title: 'B' } : w)))
    expect(after.get('explorer')).not.toBe(before.get('explorer'))
    expect(after.get('office')).toBe(before.get('office'))
  })

  it('与枚举顺序无关', () => {
    expect(windowsSignature([...base].reverse())).toEqual(windowsSignature(base))
  })
})
