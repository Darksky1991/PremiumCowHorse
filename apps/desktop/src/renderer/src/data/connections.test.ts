import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ConnectionSaveInput, PchBridge } from '@pch/shared'
import {
  countConnectionReferences,
  fetchConnectionReferenceCount,
  saveConnection,
  useConnectionActions,
  type ConnectionActions
} from './connections'

/** 假的 window.pch：invoke 一律成功（data = 输入），记录调用 */
function stubInvoke(): ReturnType<typeof vi.fn> {
  const invoke = vi.fn(async (_channel: string, input: unknown) => ({ ok: true, data: input }))
  const bridge: PchBridge = {
    invoke,
    on: () => () => undefined,
    getPathForFile: () => '',
    bootstrap: null
  }
  vi.stubGlobal('window', { pch: bridge })
  return invoke
}

const SECRET = 'plain-Secret-1'
const INPUT: ConnectionSaveInput = {
  name: 'AP1',
  host: '10.0.0.5',
  port: 22,
  username: 'ope01',
  auth: 'password',
  keyPath: null,
  secret: SECRET,
  sudoSecret: SECRET + '-sudo',
  identities: [],
  sftpServerPath: null
}

/** TanStack 的两个缓存中是否还有明文（序列化后查找） */
function cachesContainSecret(client: QueryClient): boolean {
  const mutations = client
    .getMutationCache()
    .getAll()
    .map((m) => m.state.variables)
  const queries = client
    .getQueryCache()
    .getAll()
    .map((q) => q.state.data)
  return JSON.stringify([mutations, queries]).includes(SECRET)
}

describe('机密不留在 TanStack 缓存中（保存只经一次 IPC）', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('saveConnection 直接调用 connection.save，不经 MutationCache', async () => {
    const invoke = stubInvoke()
    const client = new QueryClient()
    await saveConnection(INPUT)
    expect(invoke).toHaveBeenCalledWith('connection.save', INPUT)
    expect(client.getMutationCache().getAll()).toEqual([])
    expect(cachesContainSecret(client)).toBe(false)
  })

  it('useConnectionActions 不提供保存；其余操作的输入只有 id，执行后缓存中没有机密', async () => {
    stubInvoke()
    const client = new QueryClient()
    let actions: ConnectionActions | undefined
    const Probe = (): null => {
      actions = useConnectionActions()
      return null
    }
    renderToString(createElement(QueryClientProvider, { client }, createElement(Probe)))
    expect(actions).toBeDefined()
    const a = actions as ConnectionActions
    // 旧实现有 save（useMutation）：输入（含明文）作为 variables 留在 MutationCache 中直到 gcTime 到期
    expect(Object.keys(a).sort()).toEqual(['reconnect', 'remove', 'test', 'trustHostKey'])
    for (const key of ['remove', 'test', 'reconnect', 'trustHostKey'] as const) {
      await a[key].mutateAsync('c1')
    }
    for (const m of client.getMutationCache().getAll()) {
      expect(typeof m.state.variables).toBe('string')
    }
    expect(cachesContainSecret(client)).toBe(false)
  })
})

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
