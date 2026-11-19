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

const open = (uri: string, preview: boolean, kind: TabLocation['kind'] = 'file'): TabsAction => ({
  type: 'tab/open',
  uri,
  kind,
  title: uri.split('/').at(-1)!,
  preview
})

/** 标签的简要形式：`uri`，预览标签加 `*` 前缀，激活标签加 `!` 后缀 */
const summary = (s: TabsState): string[] =>
  s.tabs.map((t) => `${t.preview ? '*' : ''}${t.uri}${t.id === s.activeId ? '!' : ''}`)

describe('layoutReducer: tab/open', () => {
  it('在空状态下打开：新建标签并激活', () => {
    const s = run([open('a', true)])
    expect(s.tabs).toEqual([
      { id: 't1', uri: 'a', kind: 'file', title: 'a', preview: true, history: NO_HISTORY }
    ])
    expect(s.activeId).toBe('t1')
  })

  it('预览复用：单击 A（预览）→ 单击 B，B 替换 A 的位置', () => {
    const s = run([open('x', false), open('a', true), open('y', false), open('b', true)])
    // a 是 x 右侧的预览标签；y 插在激活的 a 右侧；b 替换 a（位置不变）
    expect(summary(s)).toEqual(['x', '*b!', 'y'])
  })

  it('预览标签已转常驻后，再单击打开会新开预览标签', () => {
    const s = run([open('a', true), { type: 'tab/promote', id: 't1' }, open('b', true)])
    expect(summary(s)).toEqual(['a', '*b!'])
  })

  it('同一 URI 已打开（常驻或预览）时只激活，不新建也不替换', () => {
    const s = run([open('a', false), open('b', true), open('c', false), open('a', true)])
    expect(summary(s)).toEqual(['a!', '*b', 'c'])
    const again = run([open('a', false), open('b', true), open('c', false), open('b', true)])
    expect(summary(again)).toEqual(['a', '*b!', 'c'])
  })

  it('同一 URI 的预览标签再以常驻方式打开：激活并转常驻', () => {
    const s = run([open('a', true), open('b', false), open('a', false)])
    expect(summary(s)).toEqual(['a!', 'b'])
  })

  it('常驻打开插在激活标签右侧，不替换预览标签', () => {
    const s = run([
      open('a', false),
      open('b', false),
      open('c', true),
      { type: 'tab/activate', id: 't1' },
      open('d', false)
    ])
    expect(summary(s)).toEqual(['a', 'd!', 'b', '*c'])
  })

  it('替换预览标签时使用新 id，旧标签的 viewState 不沿用', () => {
    const s = run([
      open('a', true),
      { type: 'tab/viewState', id: 't1', viewState: { scroll: 10 } },
      open('b', true)
    ])
    expect(s.tabs).toEqual([
      { id: 't2', uri: 'b', kind: 'file', title: 'b', preview: true, history: NO_HISTORY }
    ])
    expect(s.activeId).toBe('t2')
  })
})

describe('layoutReducer: tab/close', () => {
  const three = [open('a', false), open('b', false), open('c', false)]

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
    const s = run([open('a', true), { type: 'tab/close', id: 't1' }])
    expect(s).toEqual(EMPTY)
  })

  it('不存在的 id：返回同一个状态对象', () => {
    const before = run(three)
    expect(layoutReducer(before, { type: 'tab/close', id: 'nope' }, () => 'x')).toBe(before)
  })
})

describe('layoutReducer: activate / promote / navigate / viewState', () => {
  it('tab/activate 切换激活标签；不存在的 id 不变', () => {
    const s = run([open('a', false), open('b', false), { type: 'tab/activate', id: 't1' }])
    expect(s.activeId).toBe('t1')
    expect(layoutReducer(s, { type: 'tab/activate', id: 'nope' }, () => 'x')).toBe(s)
  })

  it('tab/promote 预览转常驻；已是常驻时返回同一个状态对象', () => {
    const s = run([open('a', true), { type: 'tab/promote', id: 't1' }])
    expect(s.tabs[0]!.preview).toBe(false)
    expect(layoutReducer(s, { type: 'tab/promote', id: 't1' }, () => 'x')).toBe(s)
  })

  it('tab/navigate 在同一标签内改 URI / 类型 / 标题，转常驻并清除 viewState', () => {
    const s = run([
      open('dir', true, 'directory'),
      { type: 'tab/viewState', id: 't1', viewState: { sort: 'name' } },
      { type: 'tab/navigate', id: 't1', uri: 'dir/sub', kind: 'directory', title: 'sub' }
    ])
    expect(s.tabs).toEqual([
      {
        id: 't1',
        uri: 'dir/sub',
        kind: 'directory',
        title: 'sub',
        preview: false,
        history: { back: [{ uri: 'dir', kind: 'directory', title: 'dir' }], forward: [] }
      }
    ])
    expect(s.activeId).toBe('t1')
  })

  it('tab/viewState 只改该标签的 viewState', () => {
    const s = run([
      open('a', false),
      open('b', false),
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
    const s = run([open('a', false, 'directory'), nav('b'), nav('c')])
    expect(tab1(s).uri).toBe('c')
    expect(uris(tab1(s).history.back)).toEqual(['a', 'b'])
    expect(tab1(s).history.forward).toEqual([])
  })

  it('后退：回到上一个位置（类型与标题也恢复），当前位置压入前进栈；前进反之', () => {
    const s = run([open('a', false, 'directory'), nav('b'), nav('f.txt', 'file'), back])
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
    const s = run([open('a', false, 'directory'), nav('b'), nav('c'), back, nav('d')])
    expect(tab1(s).uri).toBe('d')
    expect(uris(tab1(s).history.back)).toEqual(['a', 'b'])
    expect(tab1(s).history.forward).toEqual([])
  })

  it('没有可后退 / 前进的位置、不存在的 id：返回同一个状态对象', () => {
    const s = run([open('a', false, 'directory')])
    expect(layoutReducer(s, back, () => 'x')).toBe(s)
    expect(layoutReducer(s, forward, () => 'x')).toBe(s)
    expect(layoutReducer(s, { type: 'tab/back', id: 'nope' }, () => 'x')).toBe(s)
  })

  it('后退 / 前进转常驻并清除 viewState（与导航相同）', () => {
    const s = run([
      open('a', true, 'directory'),
      nav('b'),
      { type: 'tab/viewState', id: 't1', viewState: { sort: 'size' } },
      back
    ])
    expect(tab1(s).preview).toBe(false)
    expect(tab1(s).viewState).toBeUndefined()
  })

  it('导航到当前位置：不入栈；预览标签转常驻，viewState 保留', () => {
    const s = run([
      open('a', true, 'directory'),
      { type: 'tab/viewState', id: 't1', viewState: { sort: 'size' } },
      nav('a')
    ])
    expect(tab1(s).history.back).toEqual([])
    expect(tab1(s).preview).toBe(false)
    expect(tab1(s).viewState).toEqual({ sort: 'size' })
    expect(layoutReducer(s, nav('a'), () => 'x')).toBe(s)
  })

  it('后退栈至多 50 项：超出时丢弃最旧的', () => {
    const actions: TabsAction[] = [open('p0', false, 'directory')]
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

  it('历史属于标签：其他标签的导航不影响它；关闭后随之消失；新开 / 替换预览标签时历史为空', () => {
    const s = run([
      open('a', false, 'directory'),
      nav('b'),
      open('x', false, 'directory'),
      { type: 'tab/navigate', id: 't2', uri: 'y', kind: 'directory', title: 'y' }
    ])
    expect(uris(tab1(s).history.back)).toEqual(['a'])
    expect(uris(s.tabs[1]!.history.back)).toEqual(['x'])
    const closed = run([{ type: 'tab/close', id: 't1' }], s)
    expect(closed.tabs.map((t) => t.id)).toEqual(['t2'])
    const replaced = run([open('p', true), open('q', true)])
    expect(replaced.tabs[0]!.history).toEqual(NO_HISTORY)
  })

  it('工作区总览也是位置：可以导航到它、从它后退', () => {
    const s = run([
      open('file:///C:/a', false, 'directory'),
      nav('pch-workspace:w1', 'workspace'),
      back
    ])
    expect(tab1(s)).toMatchObject({ uri: 'file:///C:/a', kind: 'directory' })
    expect(tab1(s).history.forward).toEqual([
      { uri: 'pch-workspace:w1', kind: 'workspace', title: 'pch-workspace:w1' }
    ])
  })
})
