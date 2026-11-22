import { describe, expect, it } from 'vitest'
import { AppError, type ScannerToMain } from '@pch/shared'
import { createCompositeEnumerator } from './composite-enumerator'
import { createRemoteEnumerator, createRemoteRpc, type RemoteRpc } from './remote-enumerator'
import type { Enumerator, RawEntry } from './types'

const DIR = 'sftp://c1/var/log'

type RemoteOp = Extract<ScannerToMain, { type: 'remoteOp' }>

function setup(): { posts: ScannerToMain[]; rpc: RemoteRpc; ops: () => RemoteOp[] } {
  const posts: ScannerToMain[] = []
  const rpc = createRemoteRpc((m) => posts.push(m))
  const ops = (): RemoteOp[] => posts.filter((m): m is RemoteOp => m.type === 'remoteOp')
  return { posts, rpc, ops }
}

const codeOf = (p: Promise<unknown>): Promise<string> =>
  p.then(
    () => 'resolved',
    (e: unknown) => (e instanceof AppError ? e.code : `not an AppError: ${String(e)}`)
  )

const entries: RawEntry[] = [
  { name: 'app.log', kind: 'file', size: 10, mtime: 1000, hidden: false, owner: 'app1' },
  { name: 'old', kind: 'directory', size: 0, mtime: 2000, hidden: false, owner: 'root' },
  { name: 'cur', kind: 'symlink', target: 'file', size: 0, mtime: 3000, hidden: false }
]

describe('remote enumerator', () => {
  it('list sends remoteOp and resolves with the settled entries (owner kept)', async () => {
    const { rpc, ops } = setup()
    const en = createRemoteEnumerator(rpc)
    let batches = 0
    const p = en.list(DIR, {
      signal: new AbortController().signal,
      onBatch: () => batches++,
      userAction: true
    })
    expect(ops()).toEqual([
      { type: 'remoteOp', id: expect.any(Number), op: 'list', uri: DIR, userAction: true }
    ])
    rpc.settle({ id: ops()[0]!.id, ok: true, value: entries })
    expect(await p).toEqual(entries)
    expect(batches).toBe(1)
  })

  it('statDir sends a stat remoteOp (background by default) and returns the mtime', async () => {
    const { rpc, ops } = setup()
    const en = createRemoteEnumerator(rpc)
    const p = en.statDir(DIR, new AbortController().signal)
    expect(ops()[0]).toMatchObject({ op: 'stat', uri: DIR, userAction: false })
    rpc.settle({ id: ops()[0]!.id, ok: true, value: { mtime: 42 } })
    expect(await p).toEqual({ mtime: 42 })
  })

  it('rejects an invalid settled value with INDEX_UNAVAILABLE', async () => {
    const { rpc, ops } = setup()
    const en = createRemoteEnumerator(rpc)
    const signal = new AbortController().signal
    const l = en.list(DIR, { signal, onBatch: () => undefined })
    rpc.settle({ id: ops()[0]!.id, ok: true, value: [{ name: 'x', kind: 'socket' }] })
    expect(await codeOf(l)).toBe('INDEX_UNAVAILABLE')
    const s = en.statDir(DIR, signal)
    rpc.settle({ id: ops()[1]!.id, ok: true, value: { mtime: 'yesterday' } })
    expect(await codeOf(s)).toBe('INDEX_UNAVAILABLE')
  })

  it('passes error results through as AppError (CONN_* unchanged)', async () => {
    const { rpc, ops } = setup()
    const en = createRemoteEnumerator(rpc)
    const p = en.statDir(DIR, new AbortController().signal, { userAction: true })
    rpc.settle({ id: ops()[0]!.id, ok: false, error: { code: 'CONN_AUTH_FAILED' } })
    expect(await codeOf(p)).toBe('CONN_AUTH_FAILED')
  })

  it('rejects at once with the abort reason, sends remoteCancel and ignores a later settle', async () => {
    const { rpc, ops, posts } = setup()
    const en = createRemoteEnumerator(rpc)
    const ac = new AbortController()
    const p = en.list(DIR, { signal: ac.signal, onBatch: () => undefined })
    const id = ops()[0]!.id
    ac.abort(new AppError({ code: 'FS_TIMEOUT', detail: DIR }))
    expect(await codeOf(p)).toBe('FS_TIMEOUT')
    expect(posts).toContainEqual({ type: 'remoteCancel', id })
    expect(() => rpc.settle({ id, ok: true, value: entries })).not.toThrow()
  })

  it('does not send a request when the signal is already aborted', async () => {
    const { rpc, posts } = setup()
    const ac = new AbortController()
    ac.abort(new AppError({ code: 'FS_CANCELLED' }))
    expect(await codeOf(rpc.call('list', DIR, { signal: ac.signal, userAction: false }))).toBe(
      'FS_CANCELLED'
    )
    expect(posts).toEqual([])
  })

  it('dispose rejects in-flight requests with FS_CANCELLED', async () => {
    const { rpc } = setup()
    const signal = new AbortController().signal
    const a = rpc.call('stat', DIR, { signal, userAction: false })
    const b = rpc.call('list', DIR, { signal, userAction: true })
    rpc.dispose()
    expect(await codeOf(a)).toBe('FS_CANCELLED')
    expect(await codeOf(b)).toBe('FS_CANCELLED')
  })

  it('uses distinct ids and settles each request by its id', async () => {
    const { rpc, ops } = setup()
    const signal = new AbortController().signal
    const a = rpc.call('stat', DIR, { signal, userAction: false })
    const b = rpc.call('stat', `${DIR}/old`, { signal, userAction: false })
    const [oa, ob] = ops()
    expect(oa!.id).not.toBe(ob!.id)
    rpc.settle({ id: ob!.id, ok: true, value: 'b' })
    rpc.settle({ id: oa!.id, ok: true, value: 'a' })
    expect(await Promise.all([a, b])).toEqual(['a', 'b'])
  })

  it('reports remote location and the connection key', () => {
    const en = createRemoteEnumerator(setup().rpc)
    expect(en.native).toBe(false)
    expect(en.location('sftp://app1@c1/opt')).toBe('remote')
    expect(en.shareKey('sftp://app1@c1/opt')).toBe('sftp://c1')
    expect(en.hostKey('sftp://c1/var')).toBe('sftp://c1')
  })
})

describe('composite enumerator', () => {
  const fake = (name: string, native: boolean): Enumerator & { calls: string[] } => {
    const calls: string[] = []
    return {
      calls,
      native,
      statDir: async (uri) => (calls.push(`stat ${uri}`), { mtime: 1 }),
      list: async (uri) => (calls.push(`list ${uri}`), []),
      location: () => (name === 'remote' ? 'remote' : 'local'),
      shareKey: () => name,
      hostKey: () => name
    }
  }

  it('routes sftp: to the remote enumerator and everything else to the local one', async () => {
    const local = fake('local', true)
    const remote = fake('remote', false)
    const en = createCompositeEnumerator(local, remote)
    const signal = new AbortController().signal
    await en.statDir('sftp://c1/a', signal, { userAction: true })
    await en.list('sftp://c1/a', { signal, onBatch: () => undefined })
    await en.statDir('file:///C:/a', signal)
    await en.list('file:///C:/a', { signal, onBatch: () => undefined })
    expect(remote.calls).toEqual(['stat sftp://c1/a', 'list sftp://c1/a'])
    expect(local.calls).toEqual(['stat file:///C:/a', 'list file:///C:/a'])
    expect(en.shareKey('sftp://c1/a')).toBe('remote')
    expect(en.hostKey('file:///C:/a')).toBe('local')
    expect(en.location('sftp://c1/a')).toBe('remote')
    expect(en.native).toBe(true)
  })
})
