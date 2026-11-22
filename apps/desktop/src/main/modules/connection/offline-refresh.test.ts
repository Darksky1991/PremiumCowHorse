import { describe, expect, it, vi } from 'vitest'
import type { ConnectionState } from '@pch/shared'
import { createOfflineRefresher, OFFLINE_REFRESH_GAP_MS } from './offline-refresh'

/** 保活周期（keepaliveSec * 1000）：连接稳定存续超过它之后的断开才触发 */
const STABLE_MS = 15_000

// 连接池只对「相同状态」去重；重连失败的 offline → connecting → offline 是真实的状态变化，由本模块按上一状态过滤（R22）
function setup(roots: string[] | Error = ['sftp://c1/home']): {
  refresh: ReturnType<typeof vi.fn<(roots: string[]) => void>>
  error: ReturnType<typeof vi.fn>
  onStatus: ReturnType<typeof createOfflineRefresher>
  clock: { now: number }
  /** 状态序列；online 之后让时钟前进 stable 毫秒（默认超过保活周期） */
  run(states: readonly ConnectionState[], stable?: number): void
} {
  const refresh = vi.fn<(roots: string[]) => void>()
  const error = vi.fn()
  const clock = { now: 1_000_000 }
  const onStatus = createOfflineRefresher({
    rootsOf: async () => {
      if (roots instanceof Error) throw roots
      return roots
    },
    refresh,
    onError: error,
    now: () => clock.now,
    stableMs: () => STABLE_MS
  })
  const run = (states: readonly ConnectionState[], stable = STABLE_MS): void => {
    for (const s of states) {
      onStatus('c1', s)
      if (s === 'online') clock.now += stable
    }
  }
  return { refresh, error, onStatus, clock, run }
}
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

describe('createOfflineRefresher', () => {
  it('online → offline：对该连接的远程根 refresh 一次', async () => {
    const { refresh, run } = setup()
    run(['online', 'offline'])
    await tick()
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(refresh).toHaveBeenCalledWith(['sftp://c1/home'])
  })

  it('重连失败的 offline → connecting → offline 不再触发（避免重拨紧循环）', async () => {
    const { refresh, run } = setup()
    run(['online', 'offline', 'connecting', 'offline', 'connecting', 'offline'])
    await tick()
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('恢复 online 后再次断线（超过 60 秒）→ 再触发一次', async () => {
    const { refresh, run, clock } = setup()
    run(['online', 'offline', 'connecting'])
    clock.now += OFFLINE_REFRESH_GAP_MS
    run(['online', 'offline'])
    await tick()
    expect(refresh).toHaveBeenCalledTimes(2)
  })

  it('I2：连接只短暂 online（不到一个保活周期）就断开 → 不触发（认证后立即断开的服务器不形成重连循环）', async () => {
    const { refresh, run } = setup()
    run(['online', 'offline'], STABLE_MS - 1)
    for (let i = 0; i < 5; i++) run(['connecting', 'online', 'offline'], 10)
    await tick()
    expect(refresh).not.toHaveBeenCalled()
  })

  it('I2：同一连接 60 秒内的第二次断开 → 不触发；超过 60 秒 → 触发', async () => {
    const { refresh, run, clock } = setup()
    run(['online', 'offline', 'connecting'])
    // 稳定存续超过保活周期后再次断开，但距上次触发不到 60 秒
    run(['online', 'offline', 'connecting'])
    await tick()
    expect(refresh).toHaveBeenCalledTimes(1)
    clock.now += OFFLINE_REFRESH_GAP_MS
    run(['online', 'offline'])
    await tick()
    expect(refresh).toHaveBeenCalledTimes(2)
  })

  it('首次连接失败（idle → connecting → offline）→ 不触发', async () => {
    const { refresh, run } = setup()
    run(['idle', 'connecting', 'offline'])
    await tick()
    expect(refresh).not.toHaveBeenCalled()
  })

  it('各连接的上一状态互不影响', async () => {
    const { refresh, onStatus, clock } = setup()
    onStatus('c1', 'online')
    clock.now += STABLE_MS
    onStatus('c2', 'connecting')
    onStatus('c2', 'offline')
    await tick()
    expect(refresh).not.toHaveBeenCalled()
  })

  it.each(['idle', 'online', 'connecting', 'auth-failed'] as const)(
    '%s → 不 refresh',
    async (s) => {
      const { refresh, run } = setup()
      run([s])
      await tick()
      expect(refresh).not.toHaveBeenCalled()
    }
  )

  it('没有远程根 → 不 refresh', async () => {
    const { refresh, run } = setup([])
    run(['online', 'offline'])
    await tick()
    expect(refresh).not.toHaveBeenCalled()
  })

  it('读取根失败 → onError，不抛出', async () => {
    const { refresh, error, run } = setup(new Error('boom'))
    run(['online', 'offline'])
    await tick()
    expect(refresh).not.toHaveBeenCalled()
    expect(error).toHaveBeenCalledTimes(1)
  })
})
