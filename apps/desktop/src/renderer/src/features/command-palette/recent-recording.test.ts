import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useTabsStore } from '@renderer/stores/tabs-store'
import { RECENT_TITLE_MAX, RECENT_URI_MAX, startRecentRecording } from './recent-recording'

describe('startRecentRecording', () => {
  const record = vi.fn(() => Promise.resolve())
  const onError = vi.fn()
  let stop: () => void
  beforeEach(() => {
    record.mockClear()
    onError.mockClear()
    stop = startRecentRecording(record, onError)
  })
  afterEach(() => stop())

  const fire = (location: { uri: string; kind: string; title: string } | null): void =>
    useTabsStore.setState((s) => ({
      recentSignal: {
        seq: s.recentSignal.seq + 1,
        workspaceId: 'w1',
        location: location as never
      }
    }))

  it('records a file signal', () => {
    fire({ uri: 'file:///a.txt', kind: 'file', title: 'a.txt' })
    expect(record).toHaveBeenCalledWith('w1', {
      uri: 'file:///a.txt',
      kind: 'file',
      title: 'a.txt'
    })
  })

  it('records directories but ignores pages without a file location', () => {
    fire({ uri: 'file:///d', kind: 'directory', title: 'd' })
    fire({ uri: 'pch://settings', kind: 'settings', title: 'Settings' })
    fire(null)
    expect(record).toHaveBeenCalledTimes(1)
  })

  it('does not record when the signal did not change', () => {
    fire({ uri: 'file:///a.txt', kind: 'file', title: 'a.txt' })
    useTabsStore.setState({ byWorkspace: {} })
    expect(record).toHaveBeenCalledTimes(1)
  })

  it('truncates the title to the contract limit', () => {
    fire({ uri: 'file:///long', kind: 'file', title: 'x'.repeat(RECENT_TITLE_MAX + 50) })
    const call = record.mock.calls[0] as unknown as [string, { title: string }]
    expect(call[1].title).toHaveLength(RECENT_TITLE_MAX)
  })

  it('skips (silently) a uri over the contract limit and keeps one at the limit', () => {
    fire({ uri: 'file:///' + 'a'.repeat(RECENT_URI_MAX), kind: 'file', title: 'long' })
    expect(record).not.toHaveBeenCalled()
    expect(onError).not.toHaveBeenCalled()
    fire({ uri: 'x'.repeat(RECENT_URI_MAX), kind: 'file', title: 'edge' })
    expect(record).toHaveBeenCalledTimes(1)
  })

  it('reports a failed record instead of throwing', async () => {
    const err = new Error('boom')
    record.mockImplementationOnce(() => Promise.reject(err))
    fire({ uri: 'file:///a.txt', kind: 'file', title: 'a.txt' })
    await Promise.resolve()
    await Promise.resolve()
    expect(onError).toHaveBeenCalledWith(err)
  })
})
