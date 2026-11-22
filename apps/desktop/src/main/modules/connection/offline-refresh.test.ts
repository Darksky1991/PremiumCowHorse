import { describe, expect, it, vi } from 'vitest'
import { createOfflineRefresher } from './offline-refresh'

// 连接池只对「相同状态」去重；重连失败的 offline → connecting → offline 是真实的状态变化，由本模块按上一状态过滤（R22）
function setup(roots: string[] | Error = ['sftp://c1/home']): {
  refresh: ReturnType<typeof vi.fn<(roots: string[]) => void>>
  error: ReturnType<typeof vi.fn>
  onStatus: ReturnType<typeof createOfflineRefresher>
} {
  const refresh = vi.fn<(roots: string[]) => void>()
  const error = vi.fn()
  const onStatus = createOfflineRefresher({
    rootsOf: async () => {
      if (roots instanceof Error) throw roots
      return roots
    },
    refresh,
    onError: error
  })
  return { refresh, error, onStatus }
}
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

describe('createOfflineRefresher', () => {
  it('online → offline：对该连接的远程根 refresh 一次', async () => {
    const { refresh, onStatus } = setup()
    onStatus('c1', 'online')
    onStatus('c1', 'offline')
    await tick()
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(refresh).toHaveBeenCalledWith(['sftp://c1/home'])
  })

  it('重连失败的 offline → connecting → offline 不再触发（避免重拨紧循环）', async () => {
    const { refresh, onStatus } = setup()
    onStatus('c1', 'online')
    for (const s of ['offline', 'connecting', 'offline', 'connecting', 'offline'] as const) {
      onStatus('c1', s)
    }
    await tick()
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('恢复 online 后再次断线 → 再触发一次', async () => {
    const { refresh, onStatus } = setup()
    for (const s of ['online', 'offline', 'connecting', 'online', 'offline'] as const) {
      onStatus('c1', s)
    }
    await tick()
    expect(refresh).toHaveBeenCalledTimes(2)
  })

  it('首次连接失败（idle → connecting → offline）→ 不触发', async () => {
    const { refresh, onStatus } = setup()
    for (const s of ['idle', 'connecting', 'offline'] as const) onStatus('c1', s)
    await tick()
    expect(refresh).not.toHaveBeenCalled()
  })

  it('各连接的上一状态互不影响', async () => {
    const { refresh, onStatus } = setup()
    onStatus('c1', 'online')
    onStatus('c2', 'connecting')
    onStatus('c2', 'offline')
    await tick()
    expect(refresh).not.toHaveBeenCalled()
  })

  it.each(['idle', 'online', 'connecting', 'auth-failed'] as const)(
    '%s → 不 refresh',
    async (s) => {
      const { refresh, onStatus } = setup()
      onStatus('c1', s)
      await tick()
      expect(refresh).not.toHaveBeenCalled()
    }
  )

  it('没有远程根 → 不 refresh', async () => {
    const { refresh, onStatus } = setup([])
    onStatus('c1', 'online')
    onStatus('c1', 'offline')
    await tick()
    expect(refresh).not.toHaveBeenCalled()
  })

  it('读取根失败 → onError，不抛出', async () => {
    const { refresh, error, onStatus } = setup(new Error('boom'))
    onStatus('c1', 'online')
    onStatus('c1', 'offline')
    await tick()
    expect(refresh).not.toHaveBeenCalled()
    expect(error).toHaveBeenCalledTimes(1)
  })
})
