import { MutationObserver, QueryClient } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { startSettingsWriteWatch } from './settings-write-watch'

describe('startSettingsWriteWatch', () => {
  let client: QueryClient
  afterEach(() => client.clear())

  const run = async (mutationKey: readonly string[], fail: boolean): Promise<void> => {
    const observer = new MutationObserver(client, {
      mutationKey,
      mutationFn: async () => {
        if (fail) throw new Error('boom')
      }
    })
    await observer.mutate().catch(() => undefined)
  }

  it('reports a failed settings write once, and ignores successes and other mutations', async () => {
    client = new QueryClient()
    const onError = vi.fn()
    const stop = startSettingsWriteWatch(client, onError)
    await run(['settings.set'], false)
    await run(['other'], true)
    expect(onError).not.toHaveBeenCalled()
    await run(['settings.set'], true)
    expect(onError).toHaveBeenCalledTimes(1)
    expect((onError.mock.calls[0]?.[0] as Error).message).toBe('boom')
    stop()
    await run(['settings.set'], true)
    expect(onError).toHaveBeenCalledTimes(1)
  })
})
