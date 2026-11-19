import { beforeEach, describe, expect, it } from 'vitest'
import type { TabsState } from '@pch/shared'
import { selectActiveDirectory, selectTabs, useTabsStore, type TabTarget } from './tabs-store'

const file = (uri: string, preview: boolean): TabTarget & { preview: boolean } => ({
  uri,
  kind: 'file',
  title: uri,
  preview
})

describe('tabs-store', () => {
  beforeEach(() => useTabsStore.setState({ byWorkspace: {} }))

  it('按工作区区分标签集合：一个工作区的操作不影响另一个', () => {
    const { open } = useTabsStore.getState()
    open('w1', file('a', true))
    open('w2', file('b', false))
    open('w1', file('c', true))
    const w1 = selectTabs('w1')(useTabsStore.getState())
    const w2 = selectTabs('w2')(useTabsStore.getState())
    expect(w1.tabs.map((t) => t.uri)).toEqual(['c'])
    expect(w2.tabs.map((t) => t.uri)).toEqual(['b'])
  })

  it('close / activate / promote / navigate 只凭标签 id 找到所属工作区', () => {
    const { open } = useTabsStore.getState()
    open('w1', file('a', false))
    open('w2', file('b', true))
    open('w2', file('c', false))
    const get = (w: string): TabsState => selectTabs(w)(useTabsStore.getState())
    const [b, c] = get('w2').tabs
    useTabsStore.getState().activate(b!.id)
    expect(get('w2').activeId).toBe(b!.id)
    useTabsStore.getState().promote(b!.id)
    expect(get('w2').tabs[0]!.preview).toBe(false)
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
    useTabsStore.getState().open('w1', file('a', false))
    const before = useTabsStore.getState().byWorkspace
    useTabsStore.getState().open('w1', file('a', false))
    useTabsStore.getState().close('nope')
    expect(useTabsStore.getState().byWorkspace).toBe(before)
  })

  it('激活标签显示目录时选出其 URI（扫描进程的关注点），文件或没有标签时为 null', () => {
    const { open } = useTabsStore.getState()
    const active = (w: string | undefined): string | null =>
      selectActiveDirectory(w)(useTabsStore.getState())
    expect(active('w1')).toBeNull()
    expect(active(undefined)).toBeNull()
    open('w1', { uri: 'file:///C:/d', kind: 'directory', title: 'd', preview: false })
    expect(active('w1')).toBe('file:///C:/d')
    open('w1', file('file:///C:/d/a.txt', false))
    expect(active('w1')).toBeNull()
    expect(active('w2')).toBeNull()
  })
})
