import { describe, expect, it } from 'vitest'
import { layoutReducer, TAB_HISTORY_LIMIT } from './layout-reducer'
import type { TabLocation, TabsAction, TabsState, TabState } from './types'

const EMPTY: TabsState = { tabs: [], activeId: null }
const NO_HISTORY = { back: [], forward: [] }

/** 依次应用动作；新标签的 id 为 t1、t2…（按创建顺序） */
function run(actions: TabsAction[], initial: TabsState = EMPTY): TabsState {
  let n = 0
  const newId = (): string => `t${++n}`
  return actions.reduce((s, a) => layoutReducer(s, a, newId), initial)
}

const open = (uri: string, kind: TabLocation['kind'] = 'file'): TabsAction => ({
  type: 'tab/open',
  uri,
  kind,
  title: uri.split('/').at(-1)!
})

/** 标签的简要形式：`uri`，激活标签加 `!` 后缀 */
const summary = (s: TabsState): string[] =>
  s.tabs.map((t) => `${t.uri}${t.id === s.activeId ? '!' : ''}`)

describe('layoutReducer: tab/open', () => {
  it('在空状态下打开：新建标签并激活（没有「预览标签」字段）', () => {
    const s = run([open('a')])
    expect(s.tabs).toEqual([{ id: 't1', uri: 'a', kind: 'file', title: 'a', history: NO_HISTORY }])
    expect(s.activeId).toBe('t1')
  })

  it('新标签插在激活标签右侧；所有标签都是普通标签，不会被之后的打开替换', () => {
    const s = run([open('a'), open('b'), open('c'), { type: 'tab/activate', id: 't1' }, open('d')])
    expect(summary(s)).toEqual(['a', 'd!', 'b', 'c'])
  })

  it('同一 URI 已打开时只激活，不新建；已是激活标签时返回同一个状态对象', () => {
    const s = run([open('a'), open('b'), open('c'), open('a')])
    expect(summary(s)).toEqual(['a!', 'b', 'c'])
    expect(layoutReducer(s, open('a'), () => 'x')).toBe(s)
  })
})

describe('layoutReducer: tab/close', () => {
  const three = [open('a'), open('b'), open('c')]

  it('关闭激活标签：激活右侧相邻标签', () => {
    const s = run([...three, { type: 'tab/activate', id: 't2' }, { type: 'tab/close', id: 't2' }])
    expect(summary(s)).toEqual(['a', 'c!'])
  })

  it('关闭激活标签且右侧没有标签：激活左侧相邻标签', () => {
    const s = run([...three, { type: 'tab/close', id: 't3' }])
    expect(summary(s)).toEqual(['a', 'b!'])
  })

  it('关闭非激活标签：激活标签不变', () => {
    const s = run([...three, { type: 'tab/close', id: 't1' }])
    expect(summary(s)).toEqual(['b', 'c!'])
  })

  it('关闭最后一个标签：activeId 为 null（显示欢迎页）', () => {
    const s = run([open('a'), { type: 'tab/close', id: 't1' }])
    expect(s).toEqual(EMPTY)
  })

  it('不存在的 id：返回同一个状态对象', () => {
    const before = run(three)
    expect(layoutReducer(before, { type: 'tab/close', id: 'nope' }, () => 'x')).toBe(before)
  })
})

describe('layoutReducer: activate / navigate / viewState', () => {
  it('tab/activate 切换激活标签；不存在的 id 不变', () => {
    const s = run([open('a'), open('b'), { type: 'tab/activate', id: 't1' }])
    expect(s.activeId).toBe('t1')
    expect(layoutReducer(s, { type: 'tab/activate', id: 'nope' }, () => 'x')).toBe(s)
  })

  it('tab/navigate 在同一标签内改 URI / 类型 / 标题，并清除 viewState（离开时的 viewState 随历史保存）', () => {
    const s = run([
      open('dir', 'directory'),
      { type: 'tab/viewState', id: 't1', viewState: { sort: 'name' } },
      { type: 'tab/navigate', id: 't1', uri: 'dir/sub', kind: 'directory', title: 'sub' }
    ])
    expect(s.tabs).toEqual([
      {
        id: 't1',
        uri: 'dir/sub',
        kind: 'directory',
        title: 'sub',
        history: {
          back: [{ uri: 'dir', kind: 'directory', title: 'dir', viewState: { sort: 'name' } }],
          forward: []
        }
      }
    ])
    expect(s.activeId).toBe('t1')
  })

  it('tab/viewState 只改该标签的 viewState', () => {
    const s = run([
      open('a'),
      open('b'),
      { type: 'tab/viewState', id: 't1', viewState: { scroll: 3 } }
    ])
    expect(s.tabs[0]!.viewState).toEqual({ scroll: 3 })
    expect(s.tabs[1]!.viewState).toBeUndefined()
    expect(s.activeId).toBe('t2')
  })
})

describe('layoutReducer: 标签历史（后退 / 前进）', () => {
  const nav = (uri: string, kind: TabLocation['kind'] = 'directory'): TabsAction => ({
    type: 'tab/navigate',
    id: 't1',
    uri,
    kind,
    title: uri
  })
  const back: TabsAction = { type: 'tab/back', id: 't1' }
  const forward: TabsAction = { type: 'tab/forward', id: 't1' }
  const uris = (locs: TabLocation[]): string[] => locs.map((l) => l.uri)
  const tab1 = (s: TabsState): TabState => s.tabs.find((t) => t.id === 't1')!

  it('导航时把离开的位置压入后退栈，前进栈清空', () => {
    const s = run([open('a', 'directory'), nav('b'), nav('c')])
    expect(tab1(s).uri).toBe('c')
    expect(uris(tab1(s).history.back)).toEqual(['a', 'b'])
    expect(tab1(s).history.forward).toEqual([])
  })

  it('后退：回到上一个位置（类型与标题也恢复），当前位置压入前进栈；前进反之', () => {
    const s = run([open('a', 'directory'), nav('b'), nav('f.txt', 'file'), back])
    expect(tab1(s)).toMatchObject({ uri: 'b', kind: 'directory', title: 'b' })
    expect(uris(tab1(s).history.back)).toEqual(['a'])
    expect(uris(tab1(s).history.forward)).toEqual(['f.txt'])
    const again = run([back], s)
    expect(tab1(again).uri).toBe('a')
    expect(uris(tab1(again).history.forward)).toEqual(['f.txt', 'b'])
    const f = run([forward], again)
    expect(tab1(f)).toMatchObject({ uri: 'b', kind: 'directory' })
    expect(uris(tab1(f).history.back)).toEqual(['a'])
    expect(uris(tab1(f).history.forward)).toEqual(['f.txt'])
    const f2 = run([forward], f)
    expect(tab1(f2)).toMatchObject({ uri: 'f.txt', kind: 'file' })
    expect(tab1(f2).history.forward).toEqual([])
  })

  it('后退之后再导航：前进栈清空', () => {
    const s = run([open('a', 'directory'), nav('b'), nav('c'), back, nav('d')])
    expect(tab1(s).uri).toBe('d')
    expect(uris(tab1(s).history.back)).toEqual(['a', 'b'])
    expect(tab1(s).history.forward).toEqual([])
  })

  it('没有可后退 / 前进的位置、不存在的 id：返回同一个状态对象', () => {
    const s = run([open('a', 'directory')])
    expect(layoutReducer(s, back, () => 'x')).toBe(s)
    expect(layoutReducer(s, forward, () => 'x')).toBe(s)
    expect(layoutReducer(s, { type: 'tab/back', id: 'nope' }, () => 'x')).toBe(s)
  })

  it('后退 / 前进恢复离开该位置时的 viewState（排序、滚动、选中…），并保存当前位置的 viewState', () => {
    const setVs = (viewState: unknown): TabsAction => ({
      type: 'tab/viewState',
      id: 't1',
      viewState
    })
    const s = run([
      open('a', 'directory'),
      setVs({ sort: 'size', scrollTop: 120 }),
      nav('f.txt', 'file'),
      setVs({ page: 3 }),
      back
    ])
    expect(tab1(s)).toMatchObject({ uri: 'a', viewState: { sort: 'size', scrollTop: 120 } })
    expect(tab1(s).history.forward).toEqual([
      { uri: 'f.txt', kind: 'file', title: 'f.txt', viewState: { page: 3 } }
    ])
    const f = run([forward], s)
    expect(tab1(f)).toMatchObject({ uri: 'f.txt', viewState: { page: 3 } })
    expect(tab1(f).history.back.at(-1)).toEqual({
      uri: 'a',
      kind: 'directory',
      title: 'a',
      viewState: { sort: 'size', scrollTop: 120 }
    })
  })

  it('没有 viewState 的历史位置：后退后 viewState 为 undefined（不沿用当前位置的）', () => {
    const s = run([
      open('a', 'directory'),
      nav('b'),
      { type: 'tab/viewState', id: 't1', viewState: { sort: 'size' } },
      back
    ])
    expect(tab1(s).uri).toBe('a')
    expect(tab1(s).viewState).toBeUndefined()
    expect('viewState' in tab1(s)).toBe(false)
  })

  it('导航到新位置：viewState 清空（即使新位置曾在历史中有 viewState）', () => {
    const s = run([
      open('a', 'directory'),
      { type: 'tab/viewState', id: 't1', viewState: { sort: 'size' } },
      nav('b'),
      nav('a')
    ])
    expect(tab1(s).uri).toBe('a')
    expect(tab1(s).viewState).toBeUndefined()
  })

  it('导航到当前位置：不入栈、viewState 保留；类型与标题也相同时返回同一个状态对象', () => {
    const s = run([
      open('a', 'directory'),
      { type: 'tab/viewState', id: 't1', viewState: { sort: 'size' } },
      nav('a')
    ])
    expect(tab1(s).history.back).toEqual([])
    expect(tab1(s).viewState).toEqual({ sort: 'size' })
    expect(tab1(s).title).toBe('a')
    expect(layoutReducer(s, nav('a'), () => 'x')).toBe(s)
  })

  it('后退栈至多 50 项：超出时丢弃最旧的', () => {
    const actions: TabsAction[] = [open('p0', 'directory')]
    for (let i = 1; i <= 60; i++) actions.push(nav(`p${i}`))
    const s = run(actions)
    expect(tab1(s).history.back).toHaveLength(TAB_HISTORY_LIMIT)
    expect(tab1(s).history.back[0]!.uri).toBe('p10')
    expect(tab1(s).history.back.at(-1)!.uri).toBe('p59')
    // 一路后退到底：前进栈同样至多 50 项
    const backs = run(
      Array.from({ length: 60 }, () => back),
      s
    )
    expect(tab1(backs).uri).toBe('p10')
    expect(tab1(backs).history.forward).toHaveLength(TAB_HISTORY_LIMIT)
  })

  it('历史属于标签：其他标签的导航不影响它；关闭后随之消失；新开的标签历史为空', () => {
    const s = run([
      open('a', 'directory'),
      nav('b'),
      open('x', 'directory'),
      { type: 'tab/navigate', id: 't2', uri: 'y', kind: 'directory', title: 'y' }
    ])
    expect(uris(tab1(s).history.back)).toEqual(['a'])
    expect(uris(s.tabs[1]!.history.back)).toEqual(['x'])
    const closed = run([{ type: 'tab/close', id: 't1' }], s)
    expect(closed.tabs.map((t) => t.id)).toEqual(['t2'])
    const fresh = run([open('p'), open('q')])
    expect(fresh.tabs[1]!.history).toEqual(NO_HISTORY)
  })

  it('工作区总览也是位置：可以导航到它、从它后退', () => {
    const s = run([open('file:///C:/a', 'directory'), nav('pch-workspace:w1', 'workspace'), back])
    expect(tab1(s)).toMatchObject({ uri: 'file:///C:/a', kind: 'directory' })
    expect(tab1(s).history.forward).toEqual([
      { uri: 'pch-workspace:w1', kind: 'workspace', title: 'pch-workspace:w1' }
    ])
  })
})
