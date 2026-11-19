import { describe, expect, it } from 'vitest'
import { layoutReducer } from './layout-reducer'
import type { TabsAction, TabsState } from './types'

const EMPTY: TabsState = { tabs: [], activeId: null }

/** 依次应用动作；新标签的 id 为 t1、t2…（按创建顺序） */
function run(actions: TabsAction[], initial: TabsState = EMPTY): TabsState {
  let n = 0
  const newId = (): string => `t${++n}`
  return actions.reduce((s, a) => layoutReducer(s, a, newId), initial)
}

const open = (uri: string, preview: boolean, kind: 'file' | 'directory' = 'file'): TabsAction => ({
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
    expect(s.tabs).toEqual([{ id: 't1', uri: 'a', kind: 'file', title: 'a', preview: true }])
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
    expect(s.tabs).toEqual([{ id: 't2', uri: 'b', kind: 'file', title: 'b', preview: true }])
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
      { id: 't1', uri: 'dir/sub', kind: 'directory', title: 'sub', preview: false }
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
