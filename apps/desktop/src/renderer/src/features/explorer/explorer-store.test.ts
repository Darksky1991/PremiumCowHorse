import { beforeEach, describe, expect, it } from 'vitest'
import { expandNodes, toggleExpanded, useExplorerStore } from './explorer-store'

// 顶层分组（抽屉）A、B、C：互斥只作用于它们（设计 2.7，Review Focus 5）
const DRAWERS = ['entry:A', 'entry:B', 'entry:C']

describe('toggleExpanded：抽屉互斥', () => {
  it('展开一个顶层分组时收起其余顶层分组', () => {
    expect(toggleExpanded(['entry:A'], 'entry:B', DRAWERS)).toEqual(['entry:B'])
  })

  it('收起的顶层分组只去掉自己的标记，子孙的展开记录保留（重新展开后恢复）', () => {
    // A 内部：子分组 a1、条目 f 与其子目录 sub
    const insideA = ['entry:a1', 'entry:f', 'fs:f:sub']
    const opened = toggleExpanded(['entry:A', ...insideA], 'entry:B', DRAWERS)
    expect(opened).toEqual([...insideA, 'entry:B'])
    // 再展开 A：B 收起，A 内部的展开记录原样还在
    expect(toggleExpanded(opened, 'entry:A', DRAWERS)).toEqual([...insideA, 'entry:A'])
  })

  it('收起顶层分组不影响其他顶层分组（都收起也可以）', () => {
    expect(toggleExpanded(['entry:A', 'entry:x'], 'entry:A', DRAWERS)).toEqual(['entry:x'])
  })

  it('子分组、条目、真实目录按普通节点展开，不收起任何东西', () => {
    const current = ['entry:A', 'entry:a1']
    expect(toggleExpanded(current, 'entry:a2', DRAWERS)).toEqual([...current, 'entry:a2'])
    expect(toggleExpanded(current, 'fs:f:sub', DRAWERS)).toEqual([...current, 'fs:f:sub'])
    expect(toggleExpanded(current, 'entry:a1', DRAWERS)).toEqual(['entry:A'])
  })

  it('没有顶层分组（exclusive 为空）时与普通切换相同', () => {
    expect(toggleExpanded(['entry:A'], 'entry:B', [])).toEqual(['entry:A', 'entry:B'])
  })
})

describe('expandNodes：定位时一次展开祖先', () => {
  it('祖先链经过某个顶层分组时，收起其余顶层分组', () => {
    const current = ['entry:A', 'entry:f']
    expect(expandNodes(current, ['entry:B', 'entry:g', 'fs:g:sub'], DRAWERS)).toEqual([
      'entry:f',
      'entry:B',
      'entry:g',
      'fs:g:sub'
    ])
  })

  it('祖先链不经过顶层分组（未分组的条目）时，已展开的顶层分组保持不变', () => {
    expect(expandNodes(['entry:A'], ['entry:f', 'fs:f:sub'], DRAWERS)).toEqual([
      'entry:A',
      'entry:f',
      'fs:f:sub'
    ])
  })

  it('全部已展开时返回同一个数组（不引起重新渲染）', () => {
    const current = ['entry:B', 'entry:g']
    expect(expandNodes(current, ['entry:B', 'entry:g'], DRAWERS)).toBe(current)
  })

  it('重复的 id 只加一次', () => {
    expect(expandNodes([], ['entry:f', 'entry:f'], DRAWERS)).toEqual(['entry:f'])
  })
})

describe('useExplorerStore', () => {
  beforeEach(() => {
    useExplorerStore.setState({ expanded: {}, selected: {} })
  })

  it('toggle / expand 按工作区应用互斥', () => {
    const { toggle, expand } = useExplorerStore.getState()
    toggle('ws', 'entry:A', DRAWERS)
    toggle('ws', 'entry:a1', DRAWERS)
    toggle('ws', 'entry:B', DRAWERS)
    expect(useExplorerStore.getState().expanded['ws']).toEqual(['entry:a1', 'entry:B'])
    expand('ws', ['entry:A'], DRAWERS)
    expect(useExplorerStore.getState().expanded['ws']).toEqual(['entry:a1', 'entry:A'])
    // 其他工作区不受影响
    toggle('other', 'entry:B', DRAWERS)
    expect(useExplorerStore.getState().expanded['ws']).toEqual(['entry:a1', 'entry:A'])
  })

  it('collapseAll 收起该工作区的所有目录与分组，不清除选中', () => {
    const { toggle, select, collapseAll } = useExplorerStore.getState()
    toggle('ws', 'entry:A', DRAWERS)
    toggle('ws', 'fs:f:sub', DRAWERS)
    toggle('other', 'entry:B', DRAWERS)
    select('ws', 'fs:f:sub')
    collapseAll('ws')
    const s = useExplorerStore.getState()
    expect(s.expanded['ws']).toEqual([])
    expect(s.expanded['other']).toEqual(['entry:B'])
    expect(s.selected['ws']).toBe('fs:f:sub')
  })
})
