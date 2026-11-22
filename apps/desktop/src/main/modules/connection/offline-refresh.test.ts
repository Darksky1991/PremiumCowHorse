import { describe, expect, it, vi } from 'vitest'
import { createOfflineRefresher } from './offline-refresh'

// 连接池的 setState 对同一状态不重复推送（connection-pool.ts），因此这里不再另做去重
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
  it('进入 offline → 对该连接的远程根 refresh', async () => {
    const { refresh, onStatus } = setup()
    onStatus('c1', 'offline')
    await tick()
    expect(refresh).toHaveBeenCalledWith(['sftp://c1/home'])
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
    onStatus('c1', 'offline')
    await tick()
    expect(refresh).not.toHaveBeenCalled()
  })

  it('读取根失败 → onError，不抛出', async () => {
    const { refresh, error, onStatus } = setup(new Error('boom'))
    onStatus('c1', 'offline')
    await tick()
    expect(refresh).not.toHaveBeenCalled()
    expect(error).toHaveBeenCalledTimes(1)
  })
})
