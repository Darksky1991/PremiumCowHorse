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

  it('nextExpiry：消失中项目最早的移除时刻；冻结期内从冻结结束起算；没有 → null', () => {
    const s = new LiveState({ removeAfterMs: 60_000 })
    s.apply('office', [office('C:/a.docx'), office('C:/b.docx'), office('C:/c.docx')], 0)
    expect(s.nextExpiry(0)).toBeNull()
    s.apply('office', [office('C:/b.docx'), office('C:/c.docx')], 1000)
    s.apply('office', [office('C:/c.docx')], 5000)
    expect(s.nextExpiry(5000)).toBe(61_000)
    // 已过的时刻不算
    expect(s.nextExpiry(61_000)).toBe(65_000)
    s.freeze(100_000, 6000)
    expect(s.nextExpiry(6000)).toBe(160_000)
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
    s.freeze(200_000, 2000)
    s.apply('vscode', [], 2000)
    expect(s.current()).toHaveLength(0)
    expect(paths(s.retained(90_000)).sort()).toEqual(['C:\\a.docx', 'C:\\p'])
    expect(paths(s.retained(199_999)).sort()).toEqual(['C:\\a.docx', 'C:\\p'])
  })

  it('freeze 到期后再过 removeAfterMs 才移除', () => {
    const s = new LiveState({ removeAfterMs: 60_000 })
    s.apply('office', [office('C:\\a.docx')], 0)
    s.apply('office', [], 1000)
    s.freeze(100_000, 1000)
    expect(paths(s.retained(100_000 + 59_999))).toEqual(['C:\\a.docx'])
    expect(s.retained(100_000 + 60_000)).toEqual([])
  })

  it('已过期的消失项不会被之后的 freeze 复活（类别持续失败）', () => {
    const s = new LiveState({ removeAfterMs: 60_000 })
    s.apply('office', [office('C:\\a.docx')], 0)
    s.apply('office', [], 1000)
    s.markFailed('office')
    s.markFailed('office')
    expect(s.retained(100_000)).toEqual([])
    s.freeze(200_000, 100_000)
    expect(s.retained(100_000)).toEqual([])
    expect(s.retained(150_000)).toEqual([])
  })

  it('已在计时的项目随后 markFailed，60 秒后仍按时移除', () => {
    const s = new LiveState({ removeAfterMs: 60_000 })
    s.apply('office', [office('C:\\a.docx')], 0)
    s.apply('office', [], 1000)
    s.markFailed('office')
    expect(paths(s.retained(1000 + 59_999))).toEqual(['C:\\a.docx'])
    expect(s.retained(1000 + 60_000)).toEqual([])
  })
})
