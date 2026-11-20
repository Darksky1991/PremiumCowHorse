import { beforeEach, describe, expect, it } from 'vitest'
import type { TabsState } from '@pch/shared'
import {
  findTab,
  selectActiveDirectory,
  selectActiveTab,
  selectTabs,
  useTabsStore,
  type TabTarget
} from './tabs-store'

const file = (uri: string): TabTarget => ({ uri, kind: 'file', title: uri })

describe('tabs-store', () => {
  beforeEach(() => useTabsStore.setState({ byWorkspace: {}, refreshSeq: {} }))

  it('按工作区区分标签集合：一个工作区的操作不影响另一个', () => {
    const { open } = useTabsStore.getState()
    open('w1', file('a'))
    open('w2', file('b'))
    open('w1', file('c'))
    const w1 = selectTabs('w1')(useTabsStore.getState())
    const w2 = selectTabs('w2')(useTabsStore.getState())
    expect(w1.tabs.map((t) => t.uri)).toEqual(['a', 'c'])
    expect(w2.tabs.map((t) => t.uri)).toEqual(['b'])
  })

  it('findTab 在所有工作区中按 id 找标签，已关闭的为 null', () => {
    const { open } = useTabsStore.getState()
    open('w1', file('a'))
    open('w2', file('b'))
    const b = selectTabs('w2')(useTabsStore.getState()).tabs[0]!
    expect(findTab(useTabsStore.getState(), b.id)).toMatchObject({ uri: 'b' })
    useTabsStore.getState().close(b.id)
    expect(findTab(useTabsStore.getState(), b.id)).toBeNull()
  })

  it('close / activate / navigate 只凭标签 id 找到所属工作区', () => {
    const { open } = useTabsStore.getState()
    open('w1', file('a'))
    open('w2', file('b'))
    open('w2', file('c'))
    const get = (w: string): TabsState => selectTabs(w)(useTabsStore.getState())
    const [b, c] = get('w2').tabs
    useTabsStore.getState().activate(b!.id)
    expect(get('w2').activeId).toBe(b!.id)
    useTabsStore.getState().navigate(c!.id, { uri: 'd', kind: 'directory', title: 'd' })
    expect(get('w2').tabs[1]).toMatchObject({ id: c!.id, uri: 'd', kind: 'directory' })
    useTabsStore.getState().close(b!.id)
    expect(get('w2').tabs.map((t) => t.uri)).toEqual(['d'])
    expect(get('w1').tabs.map((t) => t.uri)).toEqual(['a'])
  })

  it('没有标签的工作区返回同一个空状态（选择器结果稳定）', () => {
    const state = useTabsStore.getState()
    expect(selectTabs('none')(state)).toBe(selectTabs('other')(state))
    expect(selectTabs('none')(state)).toEqual({ tabs: [], activeId: null })
  })

  it('操作没有变化时不更新 store（订阅者不会被通知）', () => {
    useTabsStore.getState().open('w1', file('a'))
    const before = useTabsStore.getState().byWorkspace
    useTabsStore.getState().open('w1', file('a'))
    useTabsStore.getState().close('nope')
    expect(useTabsStore.getState().byWorkspace).toBe(before)
  })

  it('激活标签显示目录时选出其 URI（扫描进程的关注点），文件或没有标签时为 null', () => {
    const { open } = useTabsStore.getState()
    const active = (w: string | undefined): string | null =>
      selectActiveDirectory(w)(useTabsStore.getState())
    expect(active('w1')).toBeNull()
    expect(active(undefined)).toBeNull()
    open('w1', { uri: 'file:///C:/d', kind: 'directory', title: 'd' })
    expect(active('w1')).toBe('file:///C:/d')
    open('w1', file('file:///C:/d/a.txt'))
    expect(active('w1')).toBeNull()
    expect(active('w2')).toBeNull()
    // 工作区总览不是文件系统：不作为关注点发给扫描进程
    open('w1', { uri: 'pch-workspace:w1', kind: 'workspace', title: 'w' })
    expect(active('w1')).toBeNull()
  })

  it('back / forward 凭标签 id 在其历史中后退 / 前进', () => {
    const { open } = useTabsStore.getState()
    open('w1', { uri: 'file:///C:/a', kind: 'directory', title: 'a' })
    const id = selectTabs('w1')(useTabsStore.getState()).tabs[0]!.id
    const current = (): string => selectTabs('w1')(useTabsStore.getState()).tabs[0]!.uri
    useTabsStore.getState().navigate(id, { uri: 'file:///C:/a/b', kind: 'directory', title: 'b' })
    useTabsStore.getState().back(id)
    expect(current()).toBe('file:///C:/a')
    useTabsStore.getState().forward(id)
    expect(current()).toBe('file:///C:/a/b')
  })
  it('激活标签的选择器：没有工作区 / 没有标签时为 null', () => {
    const active = (w: string | undefined): string | null =>
      selectActiveTab(w)(useTabsStore.getState())?.uri ?? null
    expect(active(undefined)).toBeNull()
    expect(active('w1')).toBeNull()
    useTabsStore.getState().open('w1', file('a'))
    useTabsStore.getState().open('w1', file('b'))
    expect(active('w1')).toBe('b')
    expect(active('w2')).toBeNull()
  })

  it('requestRefresh 按标签递增刷新序号（订阅者据此刷新），标签布局不变', () => {
    useTabsStore.getState().open('w1', file('a'))
    const id = selectTabs('w1')(useTabsStore.getState()).tabs[0]!.id
    const before = useTabsStore.getState().byWorkspace
    const seen: Array<number | undefined> = []
    const off = useTabsStore.subscribe((s, prev) => {
      if (s.refreshSeq[id] !== prev.refreshSeq[id]) seen.push(s.refreshSeq[id])
    })
    useTabsStore.getState().requestRefresh(id)
    useTabsStore.getState().requestRefresh(id)
    off()
    expect(seen).toEqual([1, 2])
    expect(useTabsStore.getState().byWorkspace).toBe(before)
  })

  it('openHere：有激活标签时在其中导航（进入历史），没有时新建；newTab 时总是 open', () => {
    const { openHere } = useTabsStore.getState()
    const get = (): TabsState => selectTabs('w1')(useTabsStore.getState())
    openHere('w1', file('a'))
    expect(get().tabs.map((t) => t.uri)).toEqual(['a'])
    const id = get().tabs[0]!.id
    openHere('w1', file('b'))
    expect(get().tabs).toMatchObject([{ id, uri: 'b' }])
    expect(get().tabs[0]!.history.back.map((l) => l.uri)).toEqual(['a'])
    // 当前位置：不变（不入栈）
    const before = useTabsStore.getState().byWorkspace
    openHere('w1', file('b'))
    expect(useTabsStore.getState().byWorkspace).toBe(before)
    // 新标签：插在右侧并激活；同 URI 已打开则只激活
    openHere('w1', file('c'), { newTab: true })
    expect(get().tabs.map((t) => t.uri)).toEqual(['b', 'c'])
    openHere('w1', file('b'), { newTab: true })
    expect(get().activeId).toBe(id)
  })

  it('setViewer 凭标签 id 设置 / 清除查看器', () => {
    useTabsStore.getState().open('w1', file('a.html'))
    const id = selectTabs('w1')(useTabsStore.getState()).tabs[0]!.id
    useTabsStore.getState().setViewer(id, 'pch.preview.text')
    expect(selectTabs('w1')(useTabsStore.getState()).tabs[0]!.viewer).toBe('pch.preview.text')
    useTabsStore.getState().setViewer(id, null)
    expect(selectTabs('w1')(useTabsStore.getState()).tabs[0]!.viewer).toBeUndefined()
  })
})
