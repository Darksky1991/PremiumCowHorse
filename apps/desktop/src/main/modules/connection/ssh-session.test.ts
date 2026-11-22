import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer, Socket, type Server as NetServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { utils, type ClientChannel } from 'ssh2'
import { AppError, type HostKeyInfo } from '@pch/shared'
import { sftpOverChannel } from './sftp-bridge'
import { wrapSftp, type RawSftp } from './sftp-session'
import {
  connectSsh,
  hostKeyInfo,
  toExecChannel,
  type SshConnectConfig,
  type SshSession
} from './ssh-session'
import { startFakeSftpServer, type FakeSftpServer } from './testing/fake-sftp-server'

const PASSWORD_METHODS = ['password', 'keyboard-interactive']

let root: string
let servers: FakeSftpServer[] = []
let sessions: SshSession[] = []
let rawServers: NetServer[] = []
let rawSockets: Socket[] = []

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'pch-sftp-'))
  await writeFile(join(root, 'a.txt'), 'hello')
  await mkdir(join(root, 'sub'))
})

afterEach(async () => {
  for (const s of sessions) s.close()
  sessions = []
  await Promise.all(servers.map((s) => s.close()))
  servers = []
  for (const s of rawSockets) s.destroy()
  rawSockets = []
  await Promise.all(rawServers.map((s) => new Promise((r) => s.close(r))))
  rawServers = []
  await rm(root, { recursive: true, force: true })
})

async function server(
  opts: Partial<Parameters<typeof startFakeSftpServer>[0]> = {}
): Promise<FakeSftpServer> {
  const s = await startFakeSftpServer({ root, users: { pchuser: 'Pch-pass1' }, ...opts })
  servers.push(s)
  return s
}

function cfg(s: FakeSftpServer, over: Partial<SshConnectConfig> = {}): SshConnectConfig {
  return {
    host: '127.0.0.1',
    port: s.port,
    username: 'pchuser',
    auth: { kind: 'password', password: 'Pch-pass1' },
    keepaliveSec: 15,
    readyTimeoutMs: 10_000,
    verifyHostKey: async () => true,
    ...over
  }
}

async function connect(c: SshConnectConfig): Promise<SshSession> {
  const s = await connectSsh(c)
  sessions.push(s)
  return s
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

const signal = (): AbortSignal => new AbortController().signal

describe('connectSsh + sftp()', () => {
  it('lists the root and resolves "." to home', async () => {
    const s = await server({ home: '/sub' })
    const session = await connect(cfg(s))
    const sftp = await session.sftp()
    const list = await sftp.readdir('/', signal())
    const names = list.map((d) => d.filename).sort()
    expect(names).toEqual(['a.txt', 'sub'])
    const a = list.find((d) => d.filename === 'a.txt')!
    expect(a.attrs.size).toBe(5)
    expect(a.attrs.mode & 0o170000).toBe(0o100000)
    expect(a.longname.trim().split(/\s+/)[2]).toBe('pchuser')
    expect(await sftp.realpath('.', signal())).toBe('/sub')
    const st = await sftp.stat('/sub', signal())
    expect(st.mode & 0o170000).toBe(0o040000)
    expect(typeof st.mtime).toBe('number')
    expect((await sftp.lstat('/a.txt', signal())).size).toBe(5)
  })

  it('maps SFTP errors and aborts', async () => {
    const s = await server()
    const sftp = await (await connect(cfg(s))).sftp()
    expect((await errorOf(sftp.stat('/nope', signal()))).code).toBe('FS_NOT_FOUND')
    const ac = new AbortController()
    ac.abort()
    expect((await errorOf(sftp.readdir('/', ac.signal))).code).toBe('FS_CANCELLED')
    const ac2 = new AbortController()
    const p = sftp.readdir('/', ac2.signal)
    ac2.abort()
    expect((await errorOf(p)).code).toBe('FS_CANCELLED')
    // 中止之后会话仍可用（晚到的结果被丢弃）
    expect((await sftp.readdir('/', signal())).length).toBe(2)
  })

  it('keyboard-interactive server: answers the prompt with the password', async () => {
    const s = await server({ authMethod: 'keyboard-interactive' })
    const session = await connect(cfg(s))
    expect((await (await session.sftp()).readdir('/', signal())).length).toBe(2)
    expect(s.authAttempts.filter((m) => PASSWORD_METHODS.includes(m))).toEqual([
      'keyboard-interactive'
    ])
  })
})

describe('authentication is submitted once', () => {
  it.each(['password', 'keyboard-interactive'] as const)(
    '%s server: wrong password → CONN_AUTH_FAILED with one attempt',
    async (authMethod) => {
      const s = await server({ authMethod })
      const err = await errorOf(
        connectSsh(cfg(s, { auth: { kind: 'password', password: 'wrong' } }))
      )
      expect(err.code).toBe('CONN_AUTH_FAILED')
      expect(err.detail ?? '').not.toContain('wrong')
      expect(s.authAttempts.filter((m) => PASSWORD_METHODS.includes(m))).toEqual([authMethod])
    }
  )

  it('private key: invalid / encrypted without passphrase / wrong passphrase → CONN_KEY_INVALID without connecting', async () => {
    const s = await server()
    const verifyHostKey = vi.fn(async () => true)
    const enc = utils.generateKeyPairSync('ed25519', {
      passphrase: 'kp-secret',
      cipher: 'aes256-ctr',
      rounds: 16
    }).private
    const cases: { privateKey: Buffer; passphrase?: string }[] = [
      { privateKey: Buffer.from('not a key') },
      { privateKey: Buffer.from(utils.generateKeyPairSync('ed25519').public) },
      { privateKey: Buffer.from(enc) },
      { privateKey: Buffer.from(enc), passphrase: 'wrong' }
    ]
    for (const key of cases) {
      const err = await errorOf(
        connectSsh(cfg(s, { auth: { kind: 'key', ...key }, verifyHostKey }))
      )
      expect(err.code).toBe('CONN_KEY_INVALID')
      expect(err.detail ?? '').not.toContain('kp-secret')
    }
    expect(verifyHostKey).not.toHaveBeenCalled()
    expect(s.authAttempts).toEqual([])
  })

  it('private key: decrypts with the passphrase, then offers publickey only if the server lists it', async () => {
    const s = await server()
    const enc = utils.generateKeyPairSync('ed25519', {
      passphrase: 'kp-secret',
      cipher: 'aes256-ctr',
      rounds: 16
    }).private
    const err = await errorOf(
      connectSsh(
        cfg(s, { auth: { kind: 'key', privateKey: Buffer.from(enc), passphrase: 'kp-secret' } })
      )
    )
    // 假服务器只提供 password：密钥能解析（不是 CONN_KEY_INVALID），但不提交任何密码类认证
    expect(err.code).toBe('CONN_AUTH_FAILED')
    // 连接池（Task 8）据此区分「没有可用方式」与「凭据错误」
    expect(err.detail).toContain('no acceptable method')
    expect(s.authAttempts.filter((m) => m !== 'none')).toEqual([])
  })

  it('server lists both password and keyboard-interactive: wrong password is still submitted once', async () => {
    const s = await server({ authMethod: ['password', 'keyboard-interactive'] })
    const err = await errorOf(connectSsh(cfg(s, { auth: { kind: 'password', password: 'wrong' } })))
    expect(err.code).toBe('CONN_AUTH_FAILED')
    expect(err.detail ?? '').not.toContain('no acceptable method')
    expect(s.authAttempts.filter((m) => PASSWORD_METHODS.includes(m))).toEqual(['password'])
    expect(s.kbdAnswers).toEqual([])
  })

  it('keyboard-interactive with an echo:true prompt (OTP etc.) → CONN_AUTH_FAILED, password not handed over', async () => {
    const s = await server({
      authMethod: 'keyboard-interactive',
      kbdPrompts: [
        { prompt: 'Password: ', echo: false },
        { prompt: 'Verification code: ', echo: true }
      ]
    })
    // 本端放弃认证的失败路径要真正销毁自己持有的套接字（ssh2 的 destroy() 在 end() 之后是空操作）
    const orig = Socket.prototype.destroy
    const destroyedRemotePorts: (number | undefined)[] = []
    const spy = vi.spyOn(Socket.prototype, 'destroy').mockImplementation(function (
      this: Socket,
      error?: Error
    ) {
      destroyedRemotePorts.push(this.remotePort)
      return orig.call(this, error)
    })
    let err: AppError
    try {
      err = await errorOf(connectSsh(cfg(s)))
    } finally {
      spy.mockRestore()
    }
    expect(destroyedRemotePorts).toContain(s.port)
    expect(err.code).toBe('CONN_AUTH_FAILED')
    expect(err.detail).toContain('unsupported prompt')
    expect(err.detail ?? '').not.toContain('Pch-pass1')
    expect(s.kbdAnswers).toEqual([])
  })
})

describe('host key', () => {
  it('verifyHostKey receives the server fingerprint', async () => {
    const s = await server()
    const seen: HostKeyInfo[] = []
    await connect(
      cfg(s, {
        verifyHostKey: async (k) => {
          seen.push(k)
          return true
        }
      })
    )
    expect(seen).toEqual([s.hostKey])
    expect(s.hostKey.algorithm).toBe('ssh-ed25519')
    expect(s.hostKey.fingerprint).toMatch(/^SHA256:[A-Za-z0-9+/]{43}$/)
  })

  it('rejected host key → CONN_HOST_KEY_REJECTED before authentication', async () => {
    const s = await server()
    const err = await errorOf(connectSsh(cfg(s, { verifyHostKey: async () => false })))
    expect(err.code).toBe('CONN_HOST_KEY_REJECTED')
    expect(s.authAttempts).toEqual([])
  })

  it('AppError thrown by verifyHostKey is passed through', async () => {
    const s = await server()
    const thrown = new AppError({ code: 'CONN_HOST_KEY_CHANGED' })
    const err = await errorOf(
      connectSsh(
        cfg(s, {
          verifyHostKey: async () => {
            throw thrown
          }
        })
      )
    )
    expect(err).toBe(thrown)
    expect(s.authAttempts).toEqual([])
  })

  it('hostKeyInfo: algorithm from the blob, SHA256 fingerprint without padding', () => {
    const pub = utils.generateKeyPairSync('ecdsa', { bits: 256 }).public
    const parsed = utils.parseKey(pub)
    if (parsed instanceof Error) throw parsed
    const info = hostKeyInfo(parsed.getPublicSSH())
    expect(info.algorithm).toBe('ecdsa-sha2-nistp256')
    expect(info.fingerprint).toMatch(/^SHA256:[A-Za-z0-9+/]{43}$/)
  })
})

describe('liveness', () => {
  it('readyTimeout → FS_TIMEOUT', async () => {
    const silent = createServer((sock) => rawSockets.push(sock))
    rawServers.push(silent)
    await new Promise<void>((r) => silent.listen(0, '127.0.0.1', r))
    const port = (silent.address() as { port: number }).port
    const t0 = Date.now()
    const err = await errorOf(
      connectSsh({
        host: '127.0.0.1',
        port,
        username: 'x',
        auth: { kind: 'password', password: 'x' },
        keepaliveSec: 15,
        readyTimeoutMs: 500,
        verifyHostKey: async () => true
      })
    )
    expect(err.code).toBe('FS_TIMEOUT')
    expect(Date.now() - t0).toBeLessThan(3000)
  })

  it('connection refused → FS_UNAVAILABLE', async () => {
    const s = await server()
    const port = s.port
    await s.close()
    servers = []
    const err = await errorOf(
      connectSsh({ ...cfg({ port } as FakeSftpServer), readyTimeoutMs: 3000 })
    )
    expect(err.code).toBe('FS_UNAVAILABLE')
  })

  it('freeze() → onClose(FS_UNAVAILABLE) within 6 s; in-flight requests fail FS_UNAVAILABLE', async () => {
    const s = await server()
    const session = await connect(cfg(s, { keepaliveSec: 1 }))
    const sftp = await session.sftp()
    const closed = new Promise<AppError | null>((r) => session.onClose(r))
    const t0 = Date.now()
    s.freeze()
    const pending = sftp.readdir('/', signal())
    const err = await closed
    const ms = Date.now() - t0
    expect(err?.code).toBe('FS_UNAVAILABLE')
    expect(ms).toBeLessThan(6000)
    expect((await errorOf(pending)).code).toBe('FS_UNAVAILABLE')
    // 断线之后的请求立即失败（不挂起）
    expect((await errorOf(sftp.stat('/', signal()))).code).toBe('FS_UNAVAILABLE')
    console.info(`[freeze] keepaliveSec=1 → onClose after ${ms} ms`)
  }, 10_000)

  it('close() on a silently dead server → onClose(null) within 4 s and the socket is destroyed', async () => {
    const s = await server()
    const session = await connect(cfg(s))
    const closed = new Promise<AppError | null>((r) => session.onClose(r))
    s.freeze()
    const t0 = Date.now()
    session.close()
    expect(await closed).toBeNull()
    expect(Date.now() - t0).toBeLessThan(4000)
    // ssh2 内部的 _sock 即 connectSsh 自己创建并传入的套接字
    const sock = (session.client as unknown as { _sock: Socket })._sock
    expect(sock.destroyed).toBe(true)
  }, 10_000)

  it('close() → onClose(null); exec after close → FS_UNAVAILABLE', async () => {
    const s = await server()
    const session = await connect(cfg(s))
    const closed = new Promise<AppError | null>((r) => session.onClose(r))
    session.close()
    expect(await closed).toBeNull()
    // 关闭之后注册的回调也会收到
    expect(await new Promise((r) => session.onClose(r))).toBeNull()
    expect((await errorOf(session.exec('true', { pty: false }))).code).toBe('FS_UNAVAILABLE')
  })
})

describe('wrapSftp', () => {
  it('a malformed result from ssh2 rejects instead of throwing in the callback', async () => {
    const raw = {
      on: () => raw,
      stat: () => {},
      lstat: () => {},
      realpath: () => {},
      // ssh2 回调给出非数组（不应发生，但 map 抛出时必须以拒绝结束）
      readdir: (_p: string, cb: (e: Error | undefined, v: unknown) => void) => cb(undefined, null)
    } as unknown as RawSftp
    const err = await errorOf(wrapSftp(raw).readdir('/', signal()))
    expect(err.code).toBe('UNKNOWN')
  })
})

describe('sftpOverChannel', () => {
  it('speaks SFTP over an arbitrary channel', async () => {
    const s = await server({ home: '/sub' })
    const session = await connect(cfg(s))
    const raw = await new Promise<ClientChannel>((res, rej) =>
      session.client.subsys('sftp', (e, ch) => (e ? rej(e) : res(ch)))
    )
    const sftp = await sftpOverChannel(session, toExecChannel(raw), Buffer.alloc(0))
    expect((await sftp.readdir('/', signal())).map((d) => d.filename).sort()).toEqual([
      'a.txt',
      'sub'
    ])
    expect(await sftp.realpath('.', signal())).toBe('/sub')
  })

  it('no SFTP ready within 8 s → CONN_SUDO_FAILED', async () => {
    vi.useFakeTimers()
    try {
      const { PassThrough } = await import('node:stream')
      const stream = new PassThrough()
      const closeSpy = vi.fn()
      const fakeSession = {
        client: { _protocol: { _remoteIdentRaw: 'SSH-2.0-OpenSSH_9.9' } }
      } as unknown as SshSession
      const p = sftpOverChannel(
        fakeSession,
        {
          stream,
          stderr: new PassThrough(),
          write: () => {},
          close: closeSpy,
          onClose: () => {}
        },
        Buffer.alloc(0)
      )
      const e = errorOf(p)
      await vi.advanceTimersByTimeAsync(8000)
      expect((await e).code).toBe('CONN_SUDO_FAILED')
      expect(closeSpy).toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('channel closed before ready → CONN_SUDO_FAILED', async () => {
    const { PassThrough } = await import('node:stream')
    let onClose: () => void = () => {}
    const fakeSession = {
      client: { _protocol: { _remoteIdentRaw: 'SSH-2.0-OpenSSH_9.9' } }
    } as unknown as SshSession
    const p = sftpOverChannel(
      fakeSession,
      {
        stream: new PassThrough(),
        stderr: new PassThrough(),
        write: () => {},
        close: () => {},
        onClose: (cb) => {
          onClose = cb
        }
      },
      Buffer.alloc(0)
    )
    onClose()
    expect((await errorOf(p)).code).toBe('CONN_SUDO_FAILED')
  })
})

describe('large directory', () => {
  it('readdir of 10 000 entries within 5 s', async () => {
    const big = join(root, 'big')
    await mkdir(big)
    for (let i = 0; i < 10_000; i += 500) {
      await Promise.all(
        Array.from({ length: 500 }, (_, j) => writeFile(join(big, `f${i + j}.log`), ''))
      )
    }
    const s = await server()
    const sftp = await (await connect(cfg(s))).sftp()
    const t0 = Date.now()
    const list = await sftp.readdir('/big', signal())
    const ms = Date.now() - t0
    expect(list.length).toBe(10_000)
    expect(ms).toBeLessThan(5000)
    console.info(`[readdir] 10000 entries in ${ms} ms`)
  }, 60_000)
})
