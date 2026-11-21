import { beforeEach, describe, expect, it } from 'vitest'
import {
  expandNodes,
  followTo,
  openFollowed,
  toggleExpanded,
  useExplorerStore
} from './explorer-store'

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

describe('followTo / openFollowed：树跟随标签时展开所在目录本身（设计 2.4）', () => {
  it('目标目录本身展开并记为跟随展开；已展开的（用户展开、或作为祖先展开的）不记', () => {
    expect(openFollowed({ expanded: ['entry:f'], followed: [] }, 'fs:f:a')).toEqual({
      expanded: ['entry:f', 'fs:f:a'],
      followed: ['fs:f:a']
    })
    const already = { expanded: ['entry:f', 'fs:f:a'], followed: [] }
    expect(openFollowed(already, 'fs:f:a')).toBe(already)
  })

  it('进入子目录：上一个跟随展开的目录成为祖先，保持展开', () => {
    const at = { expanded: ['entry:f', 'fs:f:a'], followed: ['fs:f:a'] }
    expect(followTo(at, ['entry:f', 'fs:f:a'], 'fs:f:a/b', DRAWERS)).toBe(at)
  })

  it('离开（后退、上一级、去别处）：不在新位置祖先链上的跟随展开目录收起，树不越展越多', () => {
    const at = { expanded: ['entry:f', 'fs:f:a', 'fs:f:a/b'], followed: ['fs:f:a', 'fs:f:a/b'] }
    // 后退到 a：b 收起，a 仍是目标（保持展开、仍记为跟随展开）
    expect(followTo(at, ['entry:f'], 'fs:f:a', DRAWERS)).toEqual({
      expanded: ['entry:f', 'fs:f:a'],
      followed: ['fs:f:a']
    })
    // 上一级到条目根：a、b 都收起；条目节点（作为祖先展开的）保持
    expect(followTo(at, [], 'entry:f', DRAWERS)).toEqual({
      expanded: ['entry:f'],
      followed: []
    })
  })

  it('用户自己展开的目录不因离开而收起；新位置的祖先照旧展开（含抽屉互斥）', () => {
    const at = { expanded: ['entry:A', 'fs:f:user', 'fs:f:a'], followed: ['fs:f:a'] }
    expect(followTo(at, ['entry:B', 'entry:g'], 'fs:g:x', DRAWERS)).toEqual({
      expanded: ['fs:f:user', 'entry:B', 'entry:g'],
      followed: ['entry:B', 'entry:g']
    })
  })

  it('祖先链中本次新展开的节点也记为跟随展开（离开时一并收起）；原本已展开的不记', () => {
    const at = { expanded: ['entry:f'], followed: [] }
    const inside = followTo(at, ['entry:f', 'fs:f:d'], 'fs:f:d/e', DRAWERS)
    expect(inside).toEqual({ expanded: ['entry:f', 'fs:f:d'], followed: ['fs:f:d'] })
    // 目标出现后展开自身；后退到 d：e 收起，d 是目标（保持）；再去条目根下的文件：d 也收起
    const atE = openFollowed(inside, 'fs:f:d/e')
    const atD = followTo(atE, ['entry:f'], 'fs:f:d', DRAWERS)
    expect(atD).toEqual({ expanded: ['entry:f', 'fs:f:d'], followed: ['fs:f:d'] })
    expect(followTo(atD, ['entry:f'], 'fs:f:x.txt', DRAWERS)).toEqual({
      expanded: ['entry:f'],
      followed: []
    })
  })

  it('抽屉互斥收起的跟随展开节点不留在跟随记录中（followed ⊆ expanded）', () => {
    const at = followTo({ expanded: [], followed: [] }, ['entry:A', 'entry:a1'], 'fs:a1:x', DRAWERS)
    expect(at.followed).toEqual(['entry:A', 'entry:a1'])
    const next = followTo(at, ['entry:B', 'entry:g'], 'fs:g:y', DRAWERS)
    expect(next.followed.every((id) => next.expanded.includes(id))).toBe(true)
    expect(next.followed).toEqual(['entry:B', 'entry:g'])
  })
})

describe('useExplorerStore', () => {
  beforeEach(() => {
    useExplorerStore.setState({ expanded: {}, selected: {}, followed: {} })
  })

  it('树中打开别处（同步跳过）不改跟随记录：之后由标签驱动的同步收起它；用户随后用箭头展开的目录归用户所有、不再被收起', () => {
    // 对应 e2e tabs.spec「single click opens …」：条目根由用户展开；中键打开 設計書（同步：展开并记为跟随）
    // → Ctrl+单击 README（选中项已是该位置，同步跳过：store 不变）→ 再激活 設計書 → 菜单在新标签打开条目根（跳过）
    // → 激活 README 标签（同步：設計書 离开、收起）→ 用户点箭头展开 設計書 → 再同步到 README 时保持展开
    const { toggle, followTo, openFollowed } = useExplorerStore.getState()
    const state = (): { expanded: string[]; followed: string[] } => ({
      expanded: useExplorerStore.getState().expanded['ws'] ?? [],
      followed: useExplorerStore.getState().followed['ws'] ?? []
    })
    toggle('ws', 'entry:f', DRAWERS)
    followTo('ws', ['entry:f'], 'fs:f:design', DRAWERS)
    openFollowed('ws', 'fs:f:design')
    expect(state()).toEqual({ expanded: ['entry:f', 'fs:f:design'], followed: ['fs:f:design'] })
    // 再激活 設計書：已展开、已记录，不变
    followTo('ws', ['entry:f'], 'fs:f:design', DRAWERS)
    openFollowed('ws', 'fs:f:design')
    // 激活 README 标签：跟随展开的 設計書 收起（条目根是用户展开的，保持）
    followTo('ws', ['entry:f'], 'fs:f:README.md', DRAWERS)
    expect(state()).toEqual({ expanded: ['entry:f'], followed: [] })
    // 用户点箭头展开 設計書：归用户所有
    toggle('ws', 'fs:f:design', DRAWERS)
    expect(state()).toEqual({ expanded: ['entry:f', 'fs:f:design'], followed: [] })
    followTo('ws', ['entry:f'], 'fs:f:README.md', DRAWERS)
    followTo('ws', ['entry:f'], 'fs:f:other.txt', DRAWERS)
    expect(state().expanded).toEqual(['entry:f', 'fs:f:design'])
  })

  it('跟随展开的目录被用户折叠（toggle）或全部折叠后，不再由跟随收起 / 记录', () => {
    const { followTo, openFollowed, toggle, collapseAll } = useExplorerStore.getState()
    followTo('ws', ['entry:f'], 'fs:f:a', DRAWERS)
    openFollowed('ws', 'fs:f:a')
    expect(useExplorerStore.getState().expanded['ws']).toEqual(['entry:f', 'fs:f:a'])
    // 条目节点是本次新展开的祖先，同样记为跟随展开
    expect(useExplorerStore.getState().followed['ws']).toEqual(['entry:f', 'fs:f:a'])
    // 用户折叠再展开：之后归用户所有，离开时不收起
    toggle('ws', 'fs:f:a', DRAWERS)
    toggle('ws', 'fs:f:a', DRAWERS)
    expect(useExplorerStore.getState().followed['ws']).toEqual(['entry:f'])
    followTo('ws', [], 'entry:f', DRAWERS)
    expect(useExplorerStore.getState().expanded['ws']).toEqual(['entry:f', 'fs:f:a'])
    // 全部折叠清空跟随记录
    followTo('ws', ['entry:f'], 'fs:f:b', DRAWERS)
    openFollowed('ws', 'fs:f:b')
    collapseAll('ws')
    expect(useExplorerStore.getState().followed['ws']).toEqual([])
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
