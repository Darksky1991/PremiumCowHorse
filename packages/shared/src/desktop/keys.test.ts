import { describe, expect, it } from 'vitest'
import { desktopItemKey, openTargetsOf, pickTabs } from './keys'
import type { DesktopItem } from './types'

const office = (path: string): DesktopItem => ({
  kind: 'office',
  app: 'excel',
  path,
  readOnly: false,
  exe: 'EXCEL.EXE'
})
const explorer = (tabs: string[]): DesktopItem => ({ kind: 'explorer', tabs, bounds: null })

describe('desktopItemKey', () => {
  it('路径大小写不同的同一文件 key 相同', () => {
    expect(desktopItemKey(office('C:\\Work\\A.xlsx'))).toBe(
      desktopItemKey(office('c:\\work\\a.xlsx'))
    )
  })
  it('Explorer 标签顺序不同 key 不同', () => {
    expect(desktopItemKey(explorer(['C:\\A', 'C:\\B']))).not.toBe(
      desktopItemKey(explorer(['C:\\B', 'C:\\A']))
    )
  })
  it('各类 key 的前缀与小写规则', () => {
    expect(desktopItemKey(explorer(['C:\\A', 'C:\\B']))).toBe('explorer:c:\\a|c:\\b')
    expect(desktopItemKey(office('C:\\X.xlsx'))).toBe('office:c:\\x.xlsx')
    expect(desktopItemKey({ kind: 'vscode', target: 'C:\\P', exe: 'Code.exe', bounds: null })).toBe(
      'vscode:c:\\p'
    )
    expect(
      desktopItemKey({ kind: 'eclipse', workspace: 'C:\\WS', exe: 'eclipse.exe', bounds: null })
    ).toBe('eclipse:c:\\ws')
  })
})

describe('openTargetsOf', () => {
  it('Explorer 每个标签一项 explorer-tab:', () => {
    const set = openTargetsOf([explorer(['C:\\A', 'C:\\B'])])
    expect([...set].sort()).toEqual(['explorer-tab:c:\\a', 'explorer-tab:c:\\b'])
  })
  it('其余类别用各自的 key', () => {
    const set = openTargetsOf([office('C:\\X.xlsx')])
    expect([...set]).toEqual(['office:c:\\x.xlsx'])
  })
})

describe('pickTabs', () => {
  it('省略 tabs 时原样返回', () => {
    const item = explorer(['C:\\A', 'C:\\B'])
    expect(pickTabs(item, undefined)).toBe(item)
  })
  it('Explorer 按原顺序保留选中的标签，重复与越界忽略', () => {
    expect(pickTabs(explorer(['C:\\A', 'C:\\B', 'C:\\C']), [2, 0, 0, 9])).toEqual(
      explorer(['C:\\A', 'C:\\C'])
    )
  })
  it('一个标签都不剩时为 null', () => {
    expect(pickTabs(explorer(['C:\\A']), [])).toBeNull()
    expect(pickTabs(explorer(['C:\\A']), [5])).toBeNull()
  })
  it('非 Explorer 忽略 tabs', () => {
    const item = office('C:\\X.xlsx')
    expect(pickTabs(item, [])).toBe(item)
  })
})
