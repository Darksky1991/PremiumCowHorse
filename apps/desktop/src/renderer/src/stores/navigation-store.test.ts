import { beforeEach, describe, expect, it } from 'vitest'
import { useNavigationStore } from './navigation-store'

describe('navigation-store', () => {
  beforeEach(() => useNavigationStore.setState({ pending: null }))

  it('requestReveal 记下请求，consume 取出并清空', () => {
    const { requestReveal, consume } = useNavigationStore.getState()
    requestReveal('w1', 'file:///C:/a/b.txt')
    expect(useNavigationStore.getState().pending).toMatchObject({
      workspaceId: 'w1',
      uri: 'file:///C:/a/b.txt'
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
    requestReveal('w2', 'file:///C:/b')
    expect(useNavigationStore.getState().consume()).toMatchObject({
      workspaceId: 'w2',
      uri: 'file:///C:/b'
    })
  })
})
