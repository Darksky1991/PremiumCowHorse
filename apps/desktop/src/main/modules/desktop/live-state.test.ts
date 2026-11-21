import { describe, expect, it } from 'vitest'
import type { DesktopItem } from '@pch/shared'
import { LiveState } from './live-state'

const office = (path: string): DesktopItem => ({
  kind: 'office',
  app: 'word',
  path,
  readOnly: false,
  exe: 'WINWORD.EXE'
})
const vscode = (target: string): DesktopItem => ({
  kind: 'vscode',
  target,
  exe: 'Code.exe',
  bounds: null
})
const paths = (items: DesktopItem[]): string[] =>
  items.map((i) => (i.kind === 'office' ? i.path : i.kind === 'vscode' ? i.target : i.kind))

describe('LiveState', () => {
  it('新项目立即进入 current 与 retained', () => {
    const s = new LiveState({ removeAfterMs: 60_000 })
    expect(s.apply('office', [office('C:\\a.docx')], 0)).toBe(true)
    expect(s.current()).toHaveLength(1)
    expect(paths(s.retained(0))).toEqual(['C:\\a.docx'])
  })

  it('结果不变时返回 false', () => {
    const s = new LiveState({ removeAfterMs: 60_000 })
    s.apply('office', [office('C:\\a.docx')], 0)
    expect(s.apply('office', [office('C:\\a.docx')], 5000)).toBe(false)
  })

  it('消失的项目：current 立即去掉，retained 保留满 removeAfterMs', () => {
    const s = new LiveState({ removeAfterMs: 60_000 })
    s.apply('office', [office('C:\\a.docx'), office('C:\\b.docx')], 0)
    s.apply('office', [office('C:\\b.docx')], 1000)
    expect(s.current().map((c) => c.key)).toEqual(['office:c:\\b.docx'])
    expect(paths(s.retained(1000 + 59_999))).toContain('C:\\a.docx')
    expect(paths(s.retained(1000 + 60_000))).not.toContain('C:\\a.docx')
    expect(paths(s.retained(1000 + 60_000))).toContain('C:\\b.docx')
  })

  it('apply 报告 retained 的变化（到期移除算变化）', () => {
    const s = new LiveState({ removeAfterMs: 60_000 })
    s.apply('office', [office('C:\\a.docx')], 0)
    expect(s.apply('office', [], 1000)).toBe(true) // current 变化
    expect(s.apply('office', [], 30_000)).toBe(false)
    expect(s.apply('office', [], 61_000)).toBe(true) // retained 缩水
  })

  it('全部消失后 retained 仍含全部', () => {
    const s = new LiveState({ removeAfterMs: 60_000 })
    s.apply('office', [office('C:\\a.docx')], 0)
    s.apply('vscode', [vscode('C:\\p')], 0)
    s.apply('office', [], 5000)
    s.apply('vscode', [], 5000)
    expect(s.current()).toHaveLength(0)
    expect(paths(s.retained(5000 + 10_000)).sort()).toEqual(['C:\\a.docx', 'C:\\p'])
  })

  it('markFailed 不改动该类也不开始计时', () => {
    const s = new LiveState({ removeAfterMs: 60_000 })
    s.apply('office', [office('C:\\a.docx')], 0)
    s.markFailed('office')
    expect(s.current()).toHaveLength(1)
    expect(paths(s.retained(90_000))).toEqual(['C:\\a.docx'])
    expect(s.current()).toHaveLength(1)
  })

  it('消失中又出现则取消计时并采用新内容', () => {
    const s = new LiveState({ removeAfterMs: 60_000 })
    s.apply('vscode', [vscode('C:\\p')], 0)
    s.apply('vscode', [], 1000)
    const moved: DesktopItem = {
      kind: 'vscode',
      target: 'C:\\p',
      exe: 'Code.exe',
      bounds: { x: 1, y: 2, width: 3, height: 4 }
    }
    expect(s.apply('vscode', [moved], 30_000)).toBe(true)
    expect(s.retained(200_000)).toEqual([moved])
    expect(s.current()).toHaveLength(1)
  })

  it('某类的 apply 不影响其他类', () => {
    const s = new LiveState({ removeAfterMs: 60_000 })
    s.apply('office', [office('C:\\a.docx')], 0)
    s.apply('vscode', [], 0)
    expect(s.current()).toHaveLength(1)
  })

  it('freeze：冻结期内全部消失，retained 仍含全部', () => {
    const s = new LiveState({ removeAfterMs: 60_000 })
    s.apply('office', [office('C:\\a.docx')], 0)
    s.apply('office', [], 1000) // 冻结前已在计时
    s.apply('vscode', [vscode('C:\\p')], 1000)
    s.freeze(200_000)
    s.apply('vscode', [], 2000)
    expect(s.current()).toHaveLength(0)
    expect(paths(s.retained(90_000)).sort()).toEqual(['C:\\a.docx', 'C:\\p'])
    expect(paths(s.retained(199_999)).sort()).toEqual(['C:\\a.docx', 'C:\\p'])
  })

  it('freeze 到期后再过 removeAfterMs 才移除', () => {
    const s = new LiveState({ removeAfterMs: 60_000 })
    s.apply('office', [office('C:\\a.docx')], 0)
    s.apply('office', [], 1000)
    s.freeze(100_000)
    expect(paths(s.retained(100_000 + 59_999))).toEqual(['C:\\a.docx'])
    expect(s.retained(100_000 + 60_000)).toEqual([])
  })
})
