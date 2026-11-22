import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Duplex, Readable } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppError, type ConnectionState, type HostKeyInfo } from '@pch/shared'
import type { SftpSession } from '../../vfs/providers/sftp.provider'
import { ConnectionPool, type PoolDeps } from './connection-pool'
import type { ConnectionRecord } from './connection.repo'
import type { HostKeyGate } from './host-key-gate'
import type { SecretBox } from './secret-box'
import { connectSsh, type ExecChannel, type SshConnectConfig, type SshSession } from './ssh-session'
import { NeedsTtyError, type SwitchDeps, type SwitchResult } from './sudo-switch'
import { startFakeSftpServer, type FakeSftpServer } from './testing/fake-sftp-server'

const KEY: HostKeyInfo = { algorithm: 'ssh-ed25519', fingerprint: 'SHA256:trusted' }
const NEW_KEY: HostKeyInfo = { algorithm: 'ssh-ed25519', fingerprint: 'SHA256:changed' }
const PROBE_OK = 'Last login: yesterday\nSFTP:/usr/lib/openssh/sftp-server\nPS:ok\n'

function record(over: Partial<ConnectionRecord> = {}): ConnectionRecord {
  return {
    id: 'c1',
    name: 'AP1',
    host: 'ap1.example',
    port: 22,
    username: 'pchuser',
    auth: 'password',
    keyPath: null,
    secret: 'enc:Pch-pass1',
    sudoSecret: null,
    identities: ['app1', 'root'],
    hostKey: KEY,
    sftpServerPath: null,
    authState: 'ok',
    createdAt: 1,
    updatedAt: 1,
    ...over
  }
}

type FakeRepo = PoolDeps['repo'] & {
  records: Map<string, ConnectionRecord>
  get: ReturnType<typeof vi.fn>
  setAuthState: ReturnType<typeof vi.fn>
  setHostKey: ReturnType<typeof vi.fn>
}

function fakeRepo(initial: ConnectionRecord[]): FakeRepo {
  const records = new Map(initial.map((r) => [r.id, r]))
  return {
    records,
    get: vi.fn(async (id: string) => {
      const r = records.get(id)
      return r ? structuredClone(r) : undefined
    }),
    setAuthState: vi.fn(async (id: string, s: ConnectionRecord['authState']) => {
      const r = records.get(id)
      if (r) r.authState = s
    }),
    setHostKey: vi.fn(async (id: string, k: HostKeyInfo | null) => {
      const r = records.get(id)
      if (r) r.hostKey = k
    })
  }
}

const secrets: SecretBox = {
  available: () => true,
  encrypt: (p) => `enc:${p}`,
  decrypt: (s) => {
    if (!s.startsWith('enc:')) throw new Error('bad ciphertext')
    return s.slice(4)
  }
}

/** 让 nextTick / 微任务排空（假计时器不接管 nextTick 与 queueMicrotask） */
async function flush(): Promise<void> {
  for (let i = 0; i < 20; i++) await new Promise<void>((r) => process.nextTick(r))
}

class FakeChannel implements ExecChannel {
  readonly stream = new Duplex({ read: () => undefined, write: (_c, _e, cb) => cb() })
  readonly stderr = new Readable({ read: () => undefined })
  closed = false
  private closers: (() => void)[] = []
  write(): void {
    // 探测与身份通道的写入在本测试中无关紧要
  }
  close(): void {
    if (this.closed) return
    this.closed = true
    for (const cb of this.closers.splice(0)) queueMicrotask(cb)
  }
  onClose(cb: () => void): void {
    if (this.closed) queueMicrotask(cb)
    else this.closers.push(cb)
  }
}

function fakeSftp(): SftpSession & { readdir: ReturnType<typeof vi.fn> } {
  return {
    stat: vi.fn(async () => ({ mode: 0o040755, size: 0, mtime: 0 })),
    lstat: vi.fn(async () => ({ mode: 0o040755, size: 0, mtime: 0 })),
    readdir: vi.fn(async () => []),
    realpath: vi.fn(async () => '/home/pchuser')
  }
}

interface FakeSsh extends SshSession {
  closed: boolean
  execs: string[]
  probeOut: string
  fireClose(err: AppError | null): void
}

function fakeSsh(probeOut = PROBE_OK): FakeSsh {
  let listeners: ((e: AppError | null) => void)[] = []
  const s: FakeSsh = {
    closed: false,
    execs: [],
    probeOut,
    client: {} as SshSession['client'],
    sftp: vi.fn(async () => fakeSftp()),
    exec: vi.fn(async (cmd: string) => {
      s.execs.push(cmd)
      const ch = new FakeChannel()
      ch.stream.on('end', () => ch.close())
      queueMicrotask(() => {
        ch.stream.push(s.probeOut)
        ch.stream.push(null)
      })
      return ch
    }),
    onClose: (cb) => {
      listeners.push(cb)
    },
    close: vi.fn(() => {
      if (s.closed) return
      s.fireClose(null)
    }),
    fireClose: (err) => {
      s.closed = true
      const ls = listeners
      listeners = []
      for (const cb of ls) cb(err)
    }
  }
  return s
}

interface Harness {
  pool: ConnectionPool
  deps: PoolDeps
  repo: ReturnType<typeof fakeRepo>
  sessions: FakeSsh[]
  channels: FakeChannel[]
  states: ConnectionState[]
  connect: ReturnType<typeof vi.fn>
  openIdentity: ReturnType<typeof vi.fn>
  bridge: ReturnType<typeof vi.fn>
  ask: ReturnType<typeof vi.fn>
  readKeyFile: ReturnType<typeof vi.fn>
  presentKey: { value: HostKeyInfo }
  authResult: { value: AppError | null }
  probeOut: { value: string }
  identityPlan: ((d: SwitchDeps) => Promise<SwitchResult>) | null
}

function setup(
  over: {
    records?: ConnectionRecord[]
    repo?: ReturnType<typeof fakeRepo>
    ask?: HostKeyGate['ask']
    settings?: Partial<ReturnType<PoolDeps['settings']>>
  } = {}
): Harness {
  const repo = over.repo ?? fakeRepo(over.records ?? [record()])
  const h = {
    repo,
    sessions: [] as FakeSsh[],
    channels: [] as FakeChannel[],
    states: [] as ConnectionState[],
    presentKey: { value: KEY },
    authResult: { value: null as AppError | null },
    probeOut: { value: PROBE_OK },
    identityPlan: null as Harness['identityPlan']
  } as Harness
  h.connect = vi.fn(async (cfg: SshConnectConfig) => {
    const ok = await cfg.verifyHostKey(h.presentKey.value)
    if (!ok) throw new AppError({ code: 'CONN_HOST_KEY_REJECTED' })
    if (h.authResult.value) throw h.authResult.value
    const s = fakeSsh(h.probeOut.value)
    h.sessions.push(s)
    return s
  })
  h.openIdentity = vi.fn(async (d: SwitchDeps): Promise<SwitchResult> => {
    if (h.identityPlan) return h.identityPlan(d)
    const ch = new FakeChannel()
    h.channels.push(ch)
    return { channel: ch, firstData: Buffer.alloc(0), mode: d.mode }
  })
  h.bridge = vi.fn(async () => fakeSftp())
  h.ask = vi.fn(over.ask ?? (async () => true))
  h.readKeyFile = vi.fn(async () => Buffer.from('KEY'))
  h.deps = {
    repo,
    secrets,
    connect: h.connect as PoolDeps['connect'],
    openIdentity: h.openIdentity as unknown as PoolDeps['openIdentity'],
    bridge: h.bridge as unknown as PoolDeps['bridge'],
    readKeyFile: h.readKeyFile as PoolDeps['readKeyFile'],
    hostKeys: { ask: h.ask as HostKeyGate['ask'], answer: () => undefined },
    settings: () => ({ keepaliveSec: 15, idleDisconnectMin: 5, timeoutSec: 20, ...over.settings }),
    onStatus: (_id, s) => h.states.push(s),
    now: () => Date.now(),
    setTimer: ((fn: () => void, ms: number) => setTimeout(fn, ms)) as PoolDeps['setTimer'],
    clearTimer: ((t: ReturnType<typeof setTimeout>) => clearTimeout(t)) as PoolDeps['clearTimer'],
    log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }
  }
  h.pool = new ConnectionPool(h.deps)
  pools.push(h.pool)
  return h
}

let pools: ConnectionPool[] = []

afterEach(() => {
  for (const p of pools) p.dispose()
  pools = []
  vi.useRealTimers()
})

const LOGIN = { connectionId: 'c1', identity: null }
const APP1 = { connectionId: 'c1', identity: 'app1' }
const ROOT = { connectionId: 'c1', identity: 'root' }

function opts(
  userAction = true,
  signal = new AbortController().signal
): { userAction: boolean; signal: AbortSignal } {
  return { userAction, signal }
}

async function errorOf(p: Promise<unknown>): Promise<AppError> {
  try {
    await p
  } catch (e) {
    expect(e).toBeInstanceOf(AppError)
    return e as AppError
  }
  throw new Error('expected rejection')
}

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

describe('ConnectionPool: 连接与主机密钥', () => {
  it('连接不存在 → CONN_NOT_FOUND', async () => {
    const h = setup()
    const e = await errorOf(h.pool.session({ connectionId: 'zz', identity: null }, opts()))
    expect(e.code).toBe('CONN_NOT_FOUND')
    expect(h.connect).not.toHaveBeenCalled()
  })

  it('host_key 为空时并发 3 个请求：connect 1 次、ask 1 次，接受后都得到会话，setHostKey 1 次', async () => {
    const answer = deferred<boolean>()
    const h = setup({ records: [record({ hostKey: null })], ask: () => answer.promise })
    const ps = [1, 2, 3].map(() => h.pool.session(LOGIN, opts()))
    await flush()
    expect(h.connect).toHaveBeenCalledTimes(1)
    expect(h.ask).toHaveBeenCalledTimes(1)
    expect(h.pool.state('c1')).toBe('host-key-pending')
    answer.resolve(true)
    const ss = await Promise.all(ps)
    expect(ss).toHaveLength(3)
    expect(ss[0]).toBe(ss[1])
    expect(h.repo.setHostKey).toHaveBeenCalledTimes(1)
    expect(h.repo.setHostKey).toHaveBeenCalledWith('c1', KEY)
    expect(h.pool.state('c1')).toBe('online')
    expect(h.states).toEqual(['connecting', 'host-key-pending', 'connecting', 'online'])
    // R5：首次连接（要询问）时 readyTimeout 至少 5 分钟
    const cfg = h.connect.mock.calls[0]![0] as SshConnectConfig
    expect(cfg.readyTimeoutMs).toBe(300_000)
    expect(cfg.keepaliveSec).toBe(15)
    expect(cfg.auth).toEqual({ kind: 'password', password: 'Pch-pass1' })
  })

  it('已信任主机密钥时 readyTimeout = timeoutSec', async () => {
    const h = setup({ settings: { timeoutSec: 30 } })
    await h.pool.session(LOGIN, opts())
    expect((h.connect.mock.calls[0]![0] as SshConnectConfig).readyTimeoutMs).toBe(30_000)
    expect(h.ask).not.toHaveBeenCalled()
  })

  it('拒绝主机密钥 → CONN_HOST_KEY_REJECTED，不保存，状态 idle', async () => {
    const h = setup({ records: [record({ hostKey: null })], ask: async () => false })
    const e = await errorOf(h.pool.session(LOGIN, opts()))
    expect(e.code).toBe('CONN_HOST_KEY_REJECTED')
    expect(h.repo.setHostKey).not.toHaveBeenCalled()
    expect(h.pool.state('c1')).toBe('idle')
  })

  it('已保存的密钥与出示的不同 → CONN_HOST_KEY_CHANGED，不询问，记住新密钥', async () => {
    const h = setup()
    h.presentKey.value = NEW_KEY
    const e = await errorOf(h.pool.session(LOGIN, opts()))
    expect(e.code).toBe('CONN_HOST_KEY_CHANGED')
    expect(h.ask).not.toHaveBeenCalled()
    expect(h.pool.presentedHostKey('c1')).toEqual(NEW_KEY)
    expect(h.pool.state('c1')).toBe('host-key-changed')
    expect(h.repo.setHostKey).not.toHaveBeenCalled()
  })

  it('等待确认框时一个请求被取消：共享的连接尝试不中止，其他请求照常得到会话', async () => {
    const answer = deferred<boolean>()
    const h = setup({ records: [record({ hostKey: null })], ask: () => answer.promise })
    const ac = new AbortController()
    const a = h.pool.session(LOGIN, opts(true, ac.signal))
    const b = h.pool.session(LOGIN, opts())
    await flush()
    ac.abort()
    expect((await errorOf(a)).code).toBe('FS_CANCELLED')
    answer.resolve(true)
    await expect(b).resolves.toBeDefined()
    expect(h.connect).toHaveBeenCalledTimes(1)
  })
})

describe('ConnectionPool: 认证锁定', () => {
  it('认证失败 → 写锁定；之后不再连接（含新建的池）；unlock 后再连接', async () => {
    const h = setup()
    h.authResult.value = new AppError({ code: 'CONN_AUTH_FAILED', detail: 'client-authentication' })
    expect((await errorOf(h.pool.session(LOGIN, opts()))).code).toBe('CONN_AUTH_FAILED')
    expect(h.repo.setAuthState).toHaveBeenCalledWith('c1', 'auth-failed')
    expect(h.pool.state('c1')).toBe('auth-failed')

    expect((await errorOf(h.pool.session(LOGIN, opts()))).code).toBe('CONN_AUTH_FAILED')
    expect((await errorOf(h.pool.session(APP1, opts()))).code).toBe('CONN_AUTH_FAILED')
    expect(h.connect).toHaveBeenCalledTimes(1)

    const h2 = setup({ repo: h.repo })
    expect((await errorOf(h2.pool.session(LOGIN, opts()))).code).toBe('CONN_AUTH_FAILED')
    expect(h2.connect).not.toHaveBeenCalled()
    expect(h2.pool.state('c1')).toBe('auth-failed')

    h.authResult.value = null
    await h.pool.unlock('c1')
    expect(h.repo.setAuthState).toHaveBeenLastCalledWith('c1', 'ok')
    await expect(h.pool.session(LOGIN, opts())).resolves.toBeDefined()
    expect(h.connect).toHaveBeenCalledTimes(2)
  })

  it('连接尝试中途被 disconnect、随后认证失败 → 仍写锁定，下一次不再连接', async () => {
    const answer = deferred<boolean>()
    const h = setup({ records: [record({ hostKey: null })], ask: () => answer.promise })
    h.authResult.value = new AppError({ code: 'CONN_AUTH_FAILED' })
    const p = h.pool.session(LOGIN, opts())
    await flush()
    h.pool.disconnect('c1')
    answer.resolve(true)
    expect((await errorOf(p)).code).toBe('CONN_AUTH_FAILED')
    expect(h.repo.setAuthState).toHaveBeenCalledWith('c1', 'auth-failed')
    expect((await errorOf(h.pool.session(LOGIN, opts()))).code).toBe('CONN_AUTH_FAILED')
    expect(h.connect).toHaveBeenCalledTimes(1)
  })

  it('服务器没有可用的认证方式 → 不写锁定，状态 idle，下次照常尝试', async () => {
    const h = setup()
    h.authResult.value = new AppError({
      code: 'CONN_AUTH_FAILED',
      detail: 'no acceptable method (server offers: publickey)'
    })
    expect((await errorOf(h.pool.session(LOGIN, opts()))).code).toBe('CONN_AUTH_FAILED')
    expect(h.repo.setAuthState).not.toHaveBeenCalled()
    expect(h.pool.state('c1')).toBe('idle')
    await errorOf(h.pool.session(LOGIN, opts()))
    expect(h.connect).toHaveBeenCalledTimes(2)
  })

  it('私钥文件读取失败 → CONN_KEY_INVALID，不连接、不写锁定', async () => {
    const h = setup({ records: [record({ auth: 'key', keyPath: 'C:/keys/id', secret: null })] })
    h.readKeyFile.mockRejectedValueOnce(new Error('ENOENT'))
    const e = await errorOf(h.pool.session(LOGIN, opts()))
    expect(e.code).toBe('CONN_KEY_INVALID')
    expect(h.connect).not.toHaveBeenCalled()
    expect(h.repo.setAuthState).not.toHaveBeenCalled()
  })

  it('私钥登录：读取私钥文件，口令为 secret', async () => {
    const h = setup({ records: [record({ auth: 'key', keyPath: 'C:/keys/id', secret: 'enc:pp' })] })
    await h.pool.session(LOGIN, opts())
    expect(h.readKeyFile).toHaveBeenCalledWith('C:/keys/id')
    expect((h.connect.mock.calls[0]![0] as SshConnectConfig).auth).toEqual({
      kind: 'key',
      privateKey: Buffer.from('KEY'),
      passphrase: 'pp'
    })
  })

  it('connect 报 CONN_KEY_INVALID（解析失败 / 口令错）→ 不写锁定', async () => {
    const h = setup()
    h.authResult.value = new AppError({ code: 'CONN_KEY_INVALID' })
    expect((await errorOf(h.pool.session(LOGIN, opts()))).code).toBe('CONN_KEY_INVALID')
    expect(h.repo.setAuthState).not.toHaveBeenCalled()
  })

  it('保存的密码无法解密 → CONN_SECRET_UNAVAILABLE，不连接', async () => {
    const h = setup({ records: [record({ secret: 'garbage' })] })
    expect((await errorOf(h.pool.session(LOGIN, opts()))).code).toBe('CONN_SECRET_UNAVAILABLE')
    expect(h.connect).not.toHaveBeenCalled()
  })

  it('sudo 认证失败（app1）→ app1 与 root 都立即失败且不再切换；登录用户照常', async () => {
    const h = setup()
    h.identityPlan = async () => {
      throw new AppError({ code: 'CONN_SUDO_AUTH_FAILED' })
    }
    expect((await errorOf(h.pool.session(APP1, opts()))).code).toBe('CONN_SUDO_AUTH_FAILED')
    expect(h.repo.setAuthState).toHaveBeenCalledWith('c1', 'sudo-auth-failed')
    expect(h.openIdentity).toHaveBeenCalledTimes(1)

    expect((await errorOf(h.pool.session(APP1, opts()))).code).toBe('CONN_SUDO_AUTH_FAILED')
    expect((await errorOf(h.pool.session(ROOT, opts()))).code).toBe('CONN_SUDO_AUTH_FAILED')
    expect(h.openIdentity).toHaveBeenCalledTimes(1)
    await expect(h.pool.session(LOGIN, opts())).resolves.toBeDefined()
    expect(h.pool.state('c1')).toBe('online')
  })

  it('并发打开 app1 与 root、sudo 密码错误 → 密码只提交一次（身份切换逐个进行）', async () => {
    const h = setup()
    const gate = deferred<void>()
    h.identityPlan = async () => {
      await gate.promise
      throw new AppError({ code: 'CONN_SUDO_AUTH_FAILED' })
    }
    const a = h.pool.session(APP1, opts())
    const b = h.pool.session(ROOT, opts())
    await flush()
    expect(h.openIdentity).toHaveBeenCalledTimes(1)
    gate.resolve()
    expect((await errorOf(a)).code).toBe('CONN_SUDO_AUTH_FAILED')
    expect((await errorOf(b)).code).toBe('CONN_SUDO_AUTH_FAILED')
    expect(h.openIdentity).toHaveBeenCalledTimes(1)
  })

  it('排队中的身份打开被取消：不影响前一个，之后的打开仍按顺序进行', async () => {
    const h = setup()
    const gate = deferred<void>()
    let running = 0
    let maxRunning = 0
    h.identityPlan = async (d) => {
      running++
      maxRunning = Math.max(maxRunning, running)
      if (d.identity === 'app1') await gate.promise
      running--
      return { channel: new FakeChannel(), firstData: Buffer.alloc(0), mode: d.mode }
    }
    const a = h.pool.session(APP1, opts())
    const ac = new AbortController()
    const b = h.pool.session(ROOT, opts(true, ac.signal))
    await flush()
    ac.abort()
    expect((await errorOf(b)).code).toBe('FS_CANCELLED')
    const c = h.pool.session(ROOT, opts())
    await flush()
    expect(h.openIdentity).toHaveBeenCalledTimes(1)
    gate.resolve()
    await Promise.all([a, c])
    expect(maxRunning).toBe(1)
    expect(h.openIdentity).toHaveBeenCalledTimes(2)
  })

  it('读到锁定之前的请求在失败之后才建立连接 → 连接尝试重新读取，看到锁定不再提交凭据', async () => {
    const h = setup()
    h.authResult.value = new AppError({ code: 'CONN_AUTH_FAILED' })
    const stale = await h.repo.get('c1')
    const late = deferred<void>()
    h.repo.get.mockImplementationOnce(async () => stale) // 请求 A
    h.repo.get.mockImplementationOnce(async () => {
      await late.promise // 请求 B：读到的是失败之前的 ok
      return stale
    })
    h.repo.get.mockImplementationOnce(async () => stale) // A 的连接尝试
    const a = h.pool.session(LOGIN, opts())
    const b = h.pool.session(LOGIN, opts())
    expect((await errorOf(a)).code).toBe('CONN_AUTH_FAILED')
    late.resolve()
    expect((await errorOf(b)).code).toBe('CONN_AUTH_FAILED')
    expect(h.connect).toHaveBeenCalledTimes(1)
  })
})

describe('ConnectionPool: 身份会话', () => {
  it('第一次使用身份时探测一次；sudo 密码为登录密码；同一身份共享', async () => {
    const h = setup()
    const [a, b] = await Promise.all([h.pool.session(APP1, opts()), h.pool.session(APP1, opts())])
    expect(a).toBe(b)
    await h.pool.session(ROOT, opts())
    expect(h.sessions[0]!.execs).toHaveLength(1)
    expect(h.openIdentity).toHaveBeenCalledTimes(2)
    const d = h.openIdentity.mock.calls[0]![0] as SwitchDeps
    expect(d).toMatchObject({
      identity: 'app1',
      sftpServerPath: '/usr/lib/openssh/sftp-server',
      password: 'Pch-pass1',
      mode: 'nopty',
      pollIntervalMs: 150,
      timeoutMs: 15_000
    })
    expect(h.bridge).toHaveBeenCalledTimes(2)
  })

  it('sudo 密码：另设的优先；私钥登录且未设时为 null；连接指定的 sftp-server 优先', async () => {
    const h = setup({
      records: [
        record({ sudoSecret: 'enc:root-pw', sftpServerPath: '/opt/sftp-server' }),
        record({ id: 'c2', auth: 'key', keyPath: 'k', secret: 'enc:pp' })
      ]
    })
    await h.pool.session(APP1, opts())
    await h.pool.session({ connectionId: 'c2', identity: 'app1' }, opts())
    const d1 = h.openIdentity.mock.calls[0]![0] as SwitchDeps
    const d2 = h.openIdentity.mock.calls[1]![0] as SwitchDeps
    expect(d1.password).toBe('root-pw')
    expect(d1.sftpServerPath).toBe('/opt/sftp-server')
    expect(d2.password).toBeNull()
  })

  it('探测 PS:hidden → CONN_PROCESS_LIST_HIDDEN，不执行 sudo', async () => {
    const h = setup()
    h.probeOut.value = 'SFTP:/usr/lib/openssh/sftp-server\nPS:hidden\n'
    expect((await errorOf(h.pool.session(APP1, opts()))).code).toBe('CONN_PROCESS_LIST_HIDDEN')
    expect(h.openIdentity).not.toHaveBeenCalled()
  })

  it('找不到 sftp-server 且连接未指定 → CONN_SFTP_SERVER_NOT_FOUND', async () => {
    const h = setup()
    h.probeOut.value = 'PS:ok\n'
    expect((await errorOf(h.pool.session(APP1, opts()))).code).toBe('CONN_SFTP_SERVER_NOT_FOUND')
    expect(h.openIdentity).not.toHaveBeenCalled()
  })

  it('R10：失败被记住；后台请求直接失败不执行命令，用户操作才重试', async () => {
    const h = setup()
    h.identityPlan = async () => {
      throw new AppError({ code: 'CONN_SUDO_DENIED' })
    }
    expect((await errorOf(h.pool.session(APP1, opts(false)))).code).toBe('CONN_SUDO_DENIED')
    expect(h.openIdentity).toHaveBeenCalledTimes(1)
    expect((await errorOf(h.pool.session(APP1, opts(false)))).code).toBe('CONN_SUDO_DENIED')
    expect(h.openIdentity).toHaveBeenCalledTimes(1)
    // 其他身份不受影响
    await errorOf(h.pool.session(ROOT, opts(false)))
    expect(h.openIdentity).toHaveBeenCalledTimes(2)
    h.identityPlan = null
    await expect(h.pool.session(APP1, opts(true))).resolves.toBeDefined()
    expect(h.openIdentity).toHaveBeenCalledTimes(3)
  })

  it('R10：探测结果 PS:hidden 也被记住（后台请求不再探测）；断开后清除', async () => {
    const h = setup()
    h.probeOut.value = 'PS:hidden\n'
    await errorOf(h.pool.session(APP1, opts(false)))
    await errorOf(h.pool.session(APP1, opts(false)))
    expect(h.sessions[0]!.execs).toHaveLength(1)
    h.pool.disconnect('c1')
    await errorOf(h.pool.session(APP1, opts(false)))
    expect(h.sessions[1]!.execs).toHaveLength(1)
  })

  it('NeedsTtyError → 以 pty 再试一次；同一身份下次直接用 pty', async () => {
    const h = setup()
    h.identityPlan = async (d) => {
      if (d.mode === 'nopty') throw new NeedsTtyError()
      const ch = new FakeChannel()
      h.channels.push(ch)
      return { channel: ch, firstData: Buffer.alloc(0), mode: d.mode }
    }
    const s = await h.pool.session(APP1, opts())
    expect(h.openIdentity.mock.calls.map((c) => (c[0] as SwitchDeps).mode)).toEqual([
      'nopty',
      'pty'
    ])
    h.pool.invalidate(APP1, s)
    expect(h.channels[0]!.closed).toBe(true)
    await h.pool.session(APP1, opts())
    expect(h.openIdentity.mock.calls.map((c) => (c[0] as SwitchDeps).mode)).toEqual([
      'nopty',
      'pty',
      'pty'
    ])
  })

  it('身份通道意外关闭 → 下一次请求重开', async () => {
    const h = setup()
    const a = await h.pool.session(APP1, opts())
    h.channels[0]!.close()
    await flush()
    const b = await h.pool.session(APP1, opts())
    expect(b).not.toBe(a)
    expect(h.openIdentity).toHaveBeenCalledTimes(2)
  })

  it('打开中唯一的请求被取消 → 中止打开过程，不在同一请求内重开', async () => {
    const h = setup()
    let seen: AbortSignal | undefined
    h.identityPlan = (d) =>
      new Promise((_, reject) => {
        seen = d.signal
        d.signal?.addEventListener('abort', () => reject(new AppError({ code: 'FS_CANCELLED' })))
      })
    const ac = new AbortController()
    const p = h.pool.session(APP1, opts(true, ac.signal))
    await flush()
    ac.abort()
    expect((await errorOf(p)).code).toBe('FS_CANCELLED')
    expect(seen?.aborted).toBe(true)
    await flush()
    expect(h.openIdentity).toHaveBeenCalledTimes(1)
  })

  it('打开中还有其他等待者时一个请求被取消 → 不中止，其他等待者得到会话', async () => {
    const h = setup()
    const gate = deferred<void>()
    let seen: AbortSignal | undefined
    h.identityPlan = async (d) => {
      seen = d.signal
      await gate.promise
      const ch = new FakeChannel()
      return { channel: ch, firstData: Buffer.alloc(0), mode: d.mode }
    }
    const ac = new AbortController()
    const a = h.pool.session(APP1, opts(true, ac.signal))
    const b = h.pool.session(APP1, opts())
    await flush()
    ac.abort()
    expect((await errorOf(a)).code).toBe('FS_CANCELLED')
    expect(seen?.aborted).toBe(false)
    gate.resolve()
    await expect(b).resolves.toBeDefined()
    expect(h.openIdentity).toHaveBeenCalledTimes(1)
  })
})

describe('ConnectionPool: 断开', () => {
  it('空闲：最后一次请求后 idleDisconnectMin 分钟 → 关闭连接，状态 idle', async () => {
    vi.useFakeTimers()
    const h = setup({ settings: { idleDisconnectMin: 5 } })
    const s = await h.pool.session(LOGIN, opts())
    await vi.advanceTimersByTimeAsync(4 * 60_000)
    await s.readdir('/', new AbortController().signal)
    await vi.advanceTimersByTimeAsync(4 * 60_000)
    expect(h.sessions[0]!.close).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(h.sessions[0]!.close).toHaveBeenCalled()
    expect(h.pool.state('c1')).toBe('idle')
  })

  it('空闲断开时关闭身份通道；进行中的请求期间不断开', async () => {
    vi.useFakeTimers()
    const h = setup({ settings: { idleDisconnectMin: 1 } })
    const s = await h.pool.session(APP1, opts())
    const slow = deferred<never[]>()
    const inner = h.bridge.mock.results[0]!.value as Promise<ReturnType<typeof fakeSftp>>
    ;(await inner).readdir.mockReturnValueOnce(slow.promise)
    const p = s.readdir('/', new AbortController().signal)
    await vi.advanceTimersByTimeAsync(5 * 60_000)
    expect(h.sessions[0]!.close).not.toHaveBeenCalled()
    slow.resolve([])
    await p
    await vi.advanceTimersByTimeAsync(60_000)
    expect(h.sessions[0]!.close).toHaveBeenCalled()
    expect(h.channels[0]!.closed).toBe(true)
  })

  it('SSH 连接关闭（FS_UNAVAILABLE）→ 状态 offline，下一次 session() 重新连接', async () => {
    const h = setup()
    await h.pool.session(LOGIN, opts())
    await h.pool.session(APP1, opts())
    h.sessions[0]!.fireClose(new AppError({ code: 'FS_UNAVAILABLE', detail: 'keepalive' }))
    expect(h.pool.state('c1')).toBe('offline')
    expect(h.channels[0]!.closed).toBe(true)
    await h.pool.session(LOGIN, opts())
    expect(h.connect).toHaveBeenCalledTimes(2)
    expect(h.pool.state('c1')).toBe('online')
  })

  it('disconnect：关闭 SSH 与身份通道，状态 idle', async () => {
    const h = setup()
    await h.pool.session(APP1, opts())
    h.pool.disconnect('c1')
    expect(h.sessions[0]!.close).toHaveBeenCalled()
    expect(h.channels[0]!.closed).toBe(true)
    expect(h.pool.state('c1')).toBe('idle')
  })

  it('invalidate 登录会话 → 下一次重新打开 SFTP 子系统（不重连 SSH）', async () => {
    const h = setup()
    const a = await h.pool.session(LOGIN, opts())
    h.pool.invalidate(LOGIN, a)
    const b = await h.pool.session(LOGIN, opts())
    expect(b).not.toBe(a)
    expect(h.sessions[0]!.sftp).toHaveBeenCalledTimes(2)
    expect(h.connect).toHaveBeenCalledTimes(1)
  })

  it('状态不重复推送', async () => {
    const h = setup()
    await h.pool.session(LOGIN, opts())
    await h.pool.session(LOGIN, opts())
    expect(h.states).toEqual(['connecting', 'online'])
  })
})

describe('ConnectionPool: home', () => {
  it('登录用户为 realpath(.)；身份为 /', async () => {
    const h = setup()
    await expect(h.pool.home(LOGIN, new AbortController().signal)).resolves.toBe('/home/pchuser')
    await expect(h.pool.home(APP1, new AbortController().signal)).resolves.toBe('/')
  })
})

describe('ConnectionPool: test()', () => {
  it('app1 sudo 失败 → 以 identity app1 ok:false 结束，root 不出现；auth_state 为 sudo-auth-failed', async () => {
    const h = setup()
    h.identityPlan = async () => {
      throw new AppError({ code: 'CONN_SUDO_AUTH_FAILED' })
    }
    const r = await h.pool.test('c1')
    expect(r.steps.map((s) => [s.step, s.identity, s.ok])).toEqual([
      ['connect', undefined, true],
      ['hostKey', undefined, true],
      ['auth', undefined, true],
      ['sftp', undefined, true],
      ['identity', 'app1', false]
    ])
    expect(r.steps[3]!.info).toEqual({ home: '/home/pchuser' })
    expect(r.steps[4]!.error?.code).toBe('CONN_SUDO_AUTH_FAILED')
    expect(h.repo.records.get('c1')!.authState).toBe('sudo-auth-failed')
    expect(h.sessions[0]!.close).toHaveBeenCalled()
    // 不进入池
    await h.pool.session(LOGIN, opts())
    expect(h.connect).toHaveBeenCalledTimes(2)
  })

  it('身份步骤附 sftpServerPath 与 mode', async () => {
    const h = setup()
    const r = await h.pool.test('c1')
    expect(r.steps.slice(4)).toEqual([
      {
        step: 'identity',
        identity: 'app1',
        ok: true,
        info: { sftpServerPath: '/usr/lib/openssh/sftp-server', mode: 'nopty' }
      },
      {
        step: 'identity',
        identity: 'root',
        ok: true,
        info: { sftpServerPath: '/usr/lib/openssh/sftp-server', mode: 'nopty' }
      }
    ])
    expect(h.channels.every((c) => c.closed)).toBe(true)
  })

  it('锁定（auth-failed）下仍连接一次，成功后 auth_state 为 ok', async () => {
    const h = setup({ records: [record({ authState: 'auth-failed' })] })
    const r = await h.pool.test('c1')
    expect(h.connect).toHaveBeenCalledTimes(1)
    expect(r.steps.every((s) => s.ok)).toBe(true)
    expect(h.repo.records.get('c1')!.authState).toBe('ok')
    await expect(h.pool.session(LOGIN, opts())).resolves.toBeDefined()
  })

  it('认证失败 → 步骤 auth ok:false，写 auth-failed', async () => {
    const h = setup()
    h.authResult.value = new AppError({ code: 'CONN_AUTH_FAILED' })
    const r = await h.pool.test('c1')
    expect(r.steps.map((s) => [s.step, s.ok])).toEqual([
      ['connect', true],
      ['hostKey', true],
      ['auth', false]
    ])
    expect(h.repo.records.get('c1')!.authState).toBe('auth-failed')
  })

  it('主机密钥变化 → hostKey ok:false', async () => {
    const h = setup()
    h.presentKey.value = NEW_KEY
    const r = await h.pool.test('c1')
    expect(r.steps.map((s) => [s.step, s.ok, s.error?.code])).toEqual([
      ['connect', true, undefined],
      ['hostKey', false, 'CONN_HOST_KEY_CHANGED']
    ])
    expect(h.pool.presentedHostKey('c1')).toEqual(NEW_KEY)
  })

  it('私钥读取失败 → auth ok:false（CONN_KEY_INVALID），不连接', async () => {
    const h = setup({ records: [record({ auth: 'key', keyPath: 'k', secret: null })] })
    h.readKeyFile.mockRejectedValueOnce(new Error('EACCES'))
    const r = await h.pool.test('c1')
    expect(r.steps).toEqual([
      { step: 'auth', ok: false, error: expect.objectContaining({ code: 'CONN_KEY_INVALID' }) }
    ])
    expect(h.connect).not.toHaveBeenCalled()
    expect(h.repo.setAuthState).not.toHaveBeenCalled()
  })

  it('连不上 → connect ok:false', async () => {
    const h = setup()
    h.connect.mockRejectedValueOnce(new AppError({ code: 'FS_UNAVAILABLE' }))
    const r = await h.pool.test('c1')
    expect(r.steps.map((s) => [s.step, s.ok])).toEqual([['connect', false]])
  })
})

describe('ConnectionPool: 集成（fake sftp server + 真实 connectSsh）', () => {
  let root: string | undefined
  let server: FakeSftpServer | undefined

  afterEach(async () => {
    for (const p of pools) p.dispose()
    pools = []
    await server?.close()
    server = undefined
    if (root) await rm(root, { recursive: true, force: true })
    root = undefined
  })

  it('session({identity:null}).readdir("/") 成功', async () => {
    root = await mkdtemp(join(tmpdir(), 'pch-pool-'))
    await writeFile(join(root, 'a.txt'), 'hello')
    await mkdir(join(root, 'sub'))
    server = await startFakeSftpServer({ root, users: { pchuser: 'Pch-pass1' } })
    const repo = fakeRepo([
      record({ host: '127.0.0.1', port: server.port, hostKey: server.hostKey })
    ])
    const h = setup({ repo })
    const pool = new ConnectionPool({ ...h.deps, connect: connectSsh })
    pools.push(pool)
    const s = await pool.session(LOGIN, opts())
    const list = await s.readdir('/', new AbortController().signal)
    expect(list.map((d) => d.filename).sort()).toEqual(['a.txt', 'sub'])
    expect(pool.state('c1')).toBe('online')
    pool.disconnect('c1')
    expect(pool.state('c1')).toBe('idle')
  })
})
