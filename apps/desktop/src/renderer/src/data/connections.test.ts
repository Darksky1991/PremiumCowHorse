import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PchBridge } from '@pch/shared'
import { countConnectionReferences, fetchConnectionReferenceCount } from './connections'

describe('countConnectionReferences', () => {
  it('只数 sftp URI 的 connectionId 一致的条目（含切换身份），分组与本地条目不算', () => {
    const entries = [
      { uri: 'sftp://c1/var/log' },
      { uri: 'sftp://app1@c1/opt/app1' },
      { uri: 'sftp://c1' },
      { uri: 'sftp://c2/var/log' },
      { uri: 'file:///C:/c1' },
      { uri: null },
      { uri: 'sftp://' }
    ]
    expect(countConnectionReferences(entries, 'c1')).toBe(3)
    expect(countConnectionReferences(entries, 'c2')).toBe(1)
    expect(countConnectionReferences(entries, 'c3')).toBe(0)
  })
})

describe('fetchConnectionReferenceCount', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('逐个工作区读取条目并合计', async () => {
    const entries: Record<string, { uri: string | null }[]> = {
      w1: [{ uri: 'sftp://c1/a' }, { uri: null }],
      w2: [{ uri: 'sftp://root@c1/' }, { uri: 'sftp://c2/' }]
    }
    const invoke = vi.fn(async (channel: string, input: unknown) => {
      if (channel === 'workspace.list') return { ok: true, data: [{ id: 'w1' }, { id: 'w2' }] }
      if (channel === 'entry.list') {
        return { ok: true, data: entries[(input as { workspaceId: string }).workspaceId] }
      }
      return { ok: false, error: { code: 'IPC_UNKNOWN_CHANNEL' } }
    })
    const bridge: PchBridge = {
      invoke,
      on: () => () => undefined,
      getPathForFile: () => '',
      bootstrap: null
    }
    vi.stubGlobal('window', { pch: bridge })
    await expect(fetchConnectionReferenceCount('c1')).resolves.toBe(2)
    expect(invoke).toHaveBeenCalledTimes(3)
  })
})
