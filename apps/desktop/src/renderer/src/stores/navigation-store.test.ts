import { beforeEach, describe, expect, it } from 'vitest'
import type { TabsState } from '@pch/shared'
import { activeLocationChanges, useNavigationStore } from './navigation-store'
import { selectTabs, useTabsStore } from './tabs-store'

describe('navigation-store', () => {
  beforeEach(() => {
    useTabsStore.setState({ byWorkspace: {}, refreshSeq: {} })
    useNavigationStore.setState({ pending: null })
  })

  it('requestReveal 记下请求（默认 locate），consume 取出并清空', () => {
    const { requestReveal, consume } = useNavigationStore.getState()
    requestReveal('w1', 'file:///C:/a/b.txt')
    expect(useNavigationStore.getState().pending).toMatchObject({
      workspaceId: 'w1',
      uri: 'file:///C:/a/b.txt',
      mode: 'locate'
    })
    expect(consume()).toMatchObject({ workspaceId: 'w1', uri: 'file:///C:/a/b.txt' })
    expect(useNavigationStore.getState().pending).toBeNull()
    expect(consume()).toBeNull()
  })

  it('新请求取代未处理的旧请求；同一 URI 的再次请求也是新的请求（seq 不同）', () => {
    const { requestReveal } = useNavigationStore.getState()
    requestReveal('w1', 'file:///C:/a')
    const first = useNavigationStore.getState().pending
    requestReveal('w1', 'file:///C:/a')
    const second = useNavigationStore.getState().pending
    expect(second).not.toBe(first)
    expect(second!.seq).not.toBe(first!.seq)
    requestReveal('w2', 'file:///C:/b', 'sync')
    expect(useNavigationStore.getState().consume()).toMatchObject({
      workspaceId: 'w2',
      uri: 'file:///C:/b',
      mode: 'sync'
    })
  })
})

describe('激活位置 → 资源树的同步请求（设计 2.4）', () => {
  beforeEach(() => {
    useTabsStore.setState({ byWorkspace: {}, refreshSeq: {} })
    useNavigationStore.setState({ pending: null })
  })
  const dir = (uri: string): { uri: string; kind: 'directory'; title: string } => ({
    uri,
    kind: 'directory',
    title: uri
  })
  const pending = (): unknown => useNavigationStore.getState().consume()

  it('打开、标签内导航、后退、切换激活标签后各发出一次 sync 请求（激活标签的位置）', () => {
    const tabs = useTabsStore.getState()
    tabs.open('w1', dir('file:///C:/a'))
    expect(pending()).toMatchObject({ workspaceId: 'w1', uri: 'file:///C:/a', mode: 'sync' })
    const id = selectTabs('w1')(useTabsStore.getState()).activeId!
    tabs.navigate(id, dir('file:///C:/a/b'))
    expect(pending()).toMatchObject({ uri: 'file:///C:/a/b', mode: 'sync' })
    tabs.back(id)
    expect(pending()).toMatchObject({ uri: 'file:///C:/a', mode: 'sync' })
    tabs.open('w1', dir('file:///C:/x'))
    expect(pending()).toMatchObject({ uri: 'file:///C:/x' })
    tabs.activate(id)
    expect(pending()).toMatchObject({ uri: 'file:///C:/a' })
  })

  it('激活位置不变的变化（viewState、刷新、关闭非激活标签、导航到当前位置）不发出请求', () => {
    const tabs = useTabsStore.getState()
    tabs.open('w1', dir('file:///C:/a'))
    tabs.open('w1', dir('file:///C:/b'))
    const [a, b] = selectTabs('w1')(useTabsStore.getState()).tabs
    useNavigationStore.setState({ pending: null })
    tabs.setViewState(b!.id, { sort: 'size' })
    tabs.requestRefresh(b!.id)
    tabs.close(a!.id)
    tabs.navigate(b!.id, dir('file:///C:/b'))
    expect(pending()).toBeNull()
  })

  it('工作区总览也发出（资源树据此取消未触发的 ↑↓ 打开，选中不变）；关闭最后一个标签不发出', () => {
    const tabs = useTabsStore.getState()
    tabs.open('w1', { uri: 'pch-workspace:w1', kind: 'workspace', title: 'W' })
    expect(pending()).toMatchObject({ uri: 'pch-workspace:w1', mode: 'sync' })
    tabs.close(selectTabs('w1')(useTabsStore.getState()).activeId!)
    expect(pending()).toBeNull()
  })

  it('activeLocationChanges 只列出激活位置变化的工作区', () => {
    const t = (id: string, uri: string): TabsState => ({
      tabs: [{ id, uri, kind: 'directory', title: uri, history: { back: [], forward: [] } }],
      activeId: id
    })
    expect(activeLocationChanges({}, { w1: t('t1', 'a') })).toEqual([
      { workspaceId: 'w1', uri: 'a' }
    ])
    const same = { w1: t('t1', 'a'), w2: t('t2', 'b') }
    expect(activeLocationChanges(same, { ...same })).toEqual([])
    expect(activeLocationChanges(same, { ...same, w2: t('t2', 'c') })).toEqual([
      { workspaceId: 'w2', uri: 'c' }
    ])
    expect(activeLocationChanges(same, { w1: t('t3', 'a') })).toEqual([
      { workspaceId: 'w1', uri: 'a' }
    ])
  })
})
