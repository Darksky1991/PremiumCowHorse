import { describe, expect, it, vi } from 'vitest'
import type { OfflineShare } from '@pch/shared'
import type { ReachabilityChange } from '@renderer/stores/reachability-store'
import { startReachabilitySync } from './use-reachability-events'

function harness(): {
  emit: (e: ReachabilityChange) => void
  resolve: (list: OfflineShare[]) => Promise<void>
  apply: ReturnType<typeof vi.fn<(e: ReachabilityChange) => void>>
  stop: () => void
  unsubscribed: () => boolean
} {
  let listener: ((e: ReachabilityChange) => void) | null = null
  let done: (list: OfflineShare[]) => void = () => {}
  const fetched = new Promise<OfflineShare[]>((r) => (done = r))
  const apply = vi.fn<(e: ReachabilityChange) => void>()
  const stop = startReachabilitySync({
    subscribe: (l) => {
      listener = l
      return () => (listener = null)
    },
    fetchOffline: () => fetched,
    apply
  })
  return {
    emit: (e) => listener?.(e),
    resolve: async (list) => {
      done(list)
      await fetched
      await Promise.resolve()
    },
    apply,
    stop,
    unsubscribed: () => listener === null
  }
}

describe('startReachabilitySync', () => {
  it('启动时以主进程记录的断开共享初始化（窗口启动 / 重新加载前已断开的也显示）', async () => {
    const h = harness()
    await h.resolve([
      { share: '\\\\srv\\s', since: 5 },
      { share: 'E:', since: 6 }
    ])
    expect(h.apply.mock.calls).toEqual([
      [{ share: '\\\\srv\\s', state: 'offline', since: 5 }],
      [{ share: 'E:', state: 'offline', since: 6 }]
    ])
  })

  it('查询结果返回之前收到的事件优先（快照不覆盖更新的状态）', async () => {
    const h = harness()
    h.emit({ share: '\\\\srv\\s', state: 'online', since: 9 })
    await h.resolve([
      { share: '\\\\srv\\s', since: 5 },
      { share: 'E:', since: 6 }
    ])
    expect(h.apply.mock.calls).toEqual([
      [{ share: '\\\\srv\\s', state: 'online', since: 9 }],
      [{ share: 'E:', state: 'offline', since: 6 }]
    ])
  })

  it('停止后取消订阅，迟到的查询结果被忽略', async () => {
    const h = harness()
    h.stop()
    expect(h.unsubscribed()).toBe(true)
    await h.resolve([{ share: 'E:', since: 6 }])
    expect(h.apply).not.toHaveBeenCalled()
  })
})
