import { beforeEach, describe, expect, it } from 'vitest'
import { useReachabilityStore } from './reachability-store'

describe('reachability-store', () => {
  beforeEach(() => useReachabilityStore.setState({ offlineShares: {} }))

  it('offline 记下共享与断开时刻，online 移除', () => {
    const { apply } = useReachabilityStore.getState()
    apply({ share: '\\\\srv\\s', state: 'offline', since: 10 })
    apply({ share: 'E:', state: 'offline', since: 20 })
    expect(useReachabilityStore.getState().offlineShares).toEqual({ '\\\\srv\\s': 10, 'E:': 20 })
    apply({ share: '\\\\srv\\s', state: 'online', since: 30 })
    expect(useReachabilityStore.getState().offlineShares).toEqual({ 'E:': 20 })
  })

  it('已是该状态时不产生新对象（订阅者不重新渲染）', () => {
    const { apply } = useReachabilityStore.getState()
    const before = useReachabilityStore.getState().offlineShares
    apply({ share: 'E:', state: 'online', since: 1 })
    expect(useReachabilityStore.getState().offlineShares).toBe(before)
  })
})
