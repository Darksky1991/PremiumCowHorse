import { describe, expect, it } from 'vitest'
import type { DesktopItem } from '@pch/shared'
import { entryIdsOf, picksOf, tabEntryId, type ChecklistItem } from './checklist-model'

const explorer = (tabs: string[]): DesktopItem => ({ kind: 'explorer', tabs, bounds: null })
const office = (path: string): DesktopItem => ({
  kind: 'office',
  app: 'word',
  path,
  readOnly: false,
  exe: 'WINWORD.EXE'
})

const items: ChecklistItem[] = [
  { id: 'w1', item: explorer(['C:/A', 'C:/B', 'C:/C']) },
  { id: 'd1', item: office('C:/x.docx') },
  { id: 'w2', item: explorer(['C:/D']) }
]

describe('entryIdsOf', () => {
  it('Explorer 按标签展开，其余项目一项，按清单顺序', () => {
    expect(entryIdsOf(items)).toEqual([
      tabEntryId('w1', 0),
      tabEntryId('w1', 1),
      tabEntryId('w1', 2),
      'd1',
      tabEntryId('w2', 0)
    ])
  })
})

describe('picksOf', () => {
  it('全选：Explorer 带全部标签下标，其余项目没有 tabs', () => {
    expect(picksOf(items, new Set(entryIdsOf(items)))).toEqual([
      { id: 'w1', tabs: [0, 1, 2] },
      { id: 'd1' },
      { id: 'w2', tabs: [0] }
    ])
  })
  it('只选部分标签：按原顺序；一个标签都没选的窗口与未选项目不出现', () => {
    const selected = new Set([tabEntryId('w1', 2), tabEntryId('w1', 0)])
    expect(picksOf(items, selected)).toEqual([{ id: 'w1', tabs: [0, 2] }])
  })
  it('什么都没选 → 空', () => {
    expect(picksOf(items, new Set())).toEqual([])
  })
})
