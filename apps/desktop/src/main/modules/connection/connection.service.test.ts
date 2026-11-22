import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AppError,
  type ConnectionSaveInput,
  type ConnectionState,
  type HostKeyInfo
} from '@pch/shared'
import { openDatabase, type Database } from '../../infra/db/client'
import type { Logger } from '../../infra/logger'
import { ConnectionPool, type PoolDeps } from './connection-pool'
import { ConnectionRepo } from './connection.repo'
import { ConnectionService } from './connection.service'
import type { SecretBox } from './secret-box'
import type { SshSession } from './ssh-session'

const noop = (): void => undefined
const silent: Logger = { error: noop, warn: noop, info: noop, debug: noop }

const KEY: HostKeyInfo = { algorithm: 'ssh-ed25519', fingerprint: 'SHA256:old' }
const NEW_KEY: HostKeyInfo = { algorithm: 'ssh-ed25519', fingerprint: 'SHA256:new' }
const PASSWORD = 'Sup3r-Secret-Pass'

type FakePool = {
  [K in 'state' | 'presentedHostKey' | 'disconnect' | 'unlock' | 'test' | 'home']: ReturnType<
    typeof vi.fn
  >
}

function fakePool(): FakePool {
  return {
    state: vi.fn((): ConnectionState => 'idle'),
    presentedHostKey: vi.fn((): HostKeyInfo | null => null),
    disconnect: vi.fn(),
    unlock: vi.fn(async () => undefined),
    test: vi.fn(async () => ({ steps: [] })),
    home: vi.fn(async () => '/home/ops')
  }
}

function fakeSecrets(available = true): SecretBox & { available: ReturnType<typeof vi.fn> } {
  return {
    available: vi.fn(() => available),
    encrypt: (p) => `enc:${Buffer.from(p).toString('base64')}`,
    decrypt: (s) => Buffer.from(s.slice(4), 'base64').toString()
  }
}

const input = (over: Partial<ConnectionSaveInput> = {}): ConnectionSaveInput => ({
  name: 'AP1',
  host: 'ap1.example',
  port: 22,
  username: 'ops',
  auth: 'password',
  keyPath: null,
  secret: PASSWORD,
  identities: ['app1'],
  sftpServerPath: null,
  ...over
})

async function errorOf(p: Promise<unknown>): Promise<AppError> {
  try {
    await p
  } catch (e) {
    expect(e).toBeInstanceOf(AppError)
    return e as AppError
  }
  throw new Error('expected rejection')
}

describe('ConnectionService', () => {
  let db: Database
  let repo: ConnectionRepo
  let pool: FakePool
  let secrets: ReturnType<typeof fakeSecrets>
  let emitChanged: ReturnType<typeof vi.fn<() => void>>
  let onConnectionReset: ReturnType<typeof vi.fn<(id: string) => void>>
  let clock: number
  let service: ConnectionService

  const make = (): ConnectionService =>
    new ConnectionService({
      repo,
      secrets,
      pool: pool as unknown as ConnectionPool,
      emitChanged,
      onConnectionReset,
      now: () => clock
    })

  beforeEach(async () => {
    db = await openDatabase(':memory:', silent)
    repo = new ConnectionRepo(db)
    pool = fakePool()
    secrets = fakeSecrets()
    emitChanged = vi.fn<() => void>()
    onConnectionReset = vi.fn<(id: string) => void>()
    clock = 1000
    service = make()
  })
  afterEach(async () => {
    await db.destroy()
  })

  it('保存新连接：生成 id；list() 的 DTO 不含机密字段、hasSecret 为真；机密加密保存', async () => {
    const dto = await service.save(input({ sudoSecret: 'sudo-pass' }))
    expect(dto.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(dto).not.toHaveProperty('secret')
    expect(dto).not.toHaveProperty('sudoSecret')
    expect(dto.hasSecret).toBe(true)
    expect(dto.hasSudoSecret).toBe(true)
    expect(dto.authState).toBe('ok')
    expect(dto.hostKey).toBeNull()
    expect(dto.createdAt).toBe(1000)
    const [listed] = await service.list()
    expect(listed).toEqual(dto)
    expect(listed).not.toHaveProperty('secret')
    expect(JSON.stringify(listed)).not.toContain(PASSWORD)
    const rec = await repo.get(dto.id)
    expect(rec!.secret).not.toBe(PASSWORD)
    expect(secrets.decrypt(rec!.secret!)).toBe(PASSWORD)
    expect(secrets.decrypt(rec!.sudoSecret!)).toBe('sudo-pass')
    expect(emitChanged).toHaveBeenCalledTimes(1)
    expect(onConnectionReset).toHaveBeenCalledWith(dto.id)
  })

  it('list() 的 state 与 presentedHostKey 取连接池', async () => {
    const dto = await service.save(input())
    pool.state.mockReturnValue('host-key-changed')
    pool.presentedHostKey.mockReturnValue(NEW_KEY)
    const [listed] = await service.list()
    expect(listed!.state).toBe('host-key-changed')
    expect(listed!.presentedHostKey).toEqual(NEW_KEY)
    expect(pool.state).toHaveBeenCalledWith(dto.id)
  })

  it('safeStorage 不可用时带密码保存 → CONN_SECRET_UNAVAILABLE，detail 不含密码，不写库', async () => {
    secrets = fakeSecrets(false)
    service = make()
    const err = await errorOf(service.save(input()))
    expect(err.code).toBe('CONN_SECRET_UNAVAILABLE')
    expect(err.detail ?? '').not.toContain(PASSWORD)
    expect(JSON.stringify(err.toPayload())).not.toContain(PASSWORD)
    expect(await repo.list()).toEqual([])
    // sudo 密码同样
    const err2 = await errorOf(service.save(input({ secret: undefined, sudoSecret: 'sudo-pw' })))
    expect(err2.code).toBe('CONN_SECRET_UNAVAILABLE')
    expect(JSON.stringify(err2.toPayload())).not.toContain('sudo-pw')
  })

  it('safeStorage 不可用时不带机密保存可以成功', async () => {
    secrets = fakeSecrets(false)
    service = make()
    const dto = await service.save(input({ secret: undefined, auth: 'key', keyPath: 'C:\\k' }))
    expect(dto.hasSecret).toBe(false)
  })

  it('加密抛错时 → CONN_SECRET_UNAVAILABLE，detail 不含密码', async () => {
    secrets.encrypt = (p: string): string => {
      throw new Error(`cannot encrypt ${p}`)
    }
    const err = await errorOf(service.save(input()))
    expect(err.code).toBe('CONN_SECRET_UNAVAILABLE')
    expect(JSON.stringify(err.toPayload())).not.toContain(PASSWORD)
  })

  it('编辑：secret 省略 = 不变；空串 = 清除；sudoSecret null = 清除', async () => {
    const dto = await service.save(input({ sudoSecret: 'sudo-pass' }))
    const before = await repo.get(dto.id)
    const kept = await service.save(input({ id: dto.id, secret: undefined }))
    expect(kept.hasSecret).toBe(true)
    expect(kept.hasSudoSecret).toBe(true)
    expect((await repo.get(dto.id))!.secret).toBe(before!.secret)
    const cleared = await service.save(input({ id: dto.id, secret: '', sudoSecret: null }))
    expect(cleared.hasSecret).toBe(false)
    expect(cleared.hasSudoSecret).toBe(false)
  })

  it('编辑不存在的连接 → CONN_NOT_FOUND', async () => {
    expect((await errorOf(service.save(input({ id: 'nope' })))).code).toBe('CONN_NOT_FOUND')
  })

  it('改 host / port 后 hostKey 为 null；只改名称时保留', async () => {
    const dto = await service.save(input())
    await repo.setHostKey(dto.id, KEY)
    const renamed = await service.save(input({ id: dto.id, name: 'AP1 改', secret: undefined }))
    expect(renamed.hostKey).toEqual(KEY)
    const moved = await service.save(input({ id: dto.id, host: 'ap1b.example' }))
    expect(moved.hostKey).toBeNull()
    await repo.setHostKey(dto.id, KEY)
    const port = await service.save(input({ id: dto.id, host: 'ap1b.example', port: 2222 }))
    expect(port.hostKey).toBeNull()
  })

  it('锁定中的连接编辑后 authState 为 ok、updatedAt 更新（先写库再 disconnect）', async () => {
    const dto = await service.save(input())
    await repo.setAuthState(dto.id, 'auth-failed')
    pool.disconnect.mockClear()
    emitChanged.mockClear()
    onConnectionReset.mockClear()
    // 时钟没有前进（同一毫秒内的编辑）也必须得到新的 updatedAt（连接池据此判断记录被编辑）
    let atDisconnect: Awaited<ReturnType<ConnectionRepo['get']>>
    pool.disconnect.mockImplementation(() => {
      void repo.get(dto.id).then((r) => (atDisconnect = r))
    })
    const edited = await service.save(input({ id: dto.id, secret: 'new-pass' }))
    expect(edited.authState).toBe('ok')
    expect(edited.updatedAt).toBeGreaterThan(dto.updatedAt)
    expect(edited.createdAt).toBe(dto.createdAt)
    expect(pool.disconnect).toHaveBeenCalledWith(dto.id, {
      keepAuthLock: false,
      keepSudoLock: false
    })
    await new Promise((r) => setTimeout(r, 0))
    expect(atDisconnect!.authState).toBe('ok')
    expect(atDisconnect!.updatedAt).toBe(edited.updatedAt)
    expect(emitChanged).toHaveBeenCalledTimes(1)
    expect(onConnectionReset).toHaveBeenCalledWith(dto.id)
    // sudo 锁定：改了 sudo 密码才解除
    await repo.setAuthState(dto.id, 'sudo-auth-failed')
    clock = 5000
    const again = await service.save(input({ id: dto.id, secret: undefined, sudoSecret: 'sp' }))
    expect(again.authState).toBe('ok')
    expect(again.updatedAt).toBe(5000)
  })

  describe('C1：编辑只在凭据有变化时解除锁定（设计 5.3）', () => {
    const locked = async (
      state: 'auth-failed' | 'sudo-auth-failed',
      over: Partial<ConnectionSaveInput> = {}
    ): Promise<string> => {
      const dto = await service.save(input(over))
      await repo.setAuthState(dto.id, state)
      pool.disconnect.mockClear()
      onConnectionReset.mockClear()
      emitChanged.mockClear()
      return dto.id
    }

    // R25：渲染端（connection-form.ts 的 buildSaveInput）的实际输入——「同登录密码」模式每次都发送
    // sudoSecret: null，私钥认证且无口令时每次都发送 secret: ''。这些不是凭据的变化
    it('R25：sudo-auth-failed、「同登录密码」模式：只改 identities / 名称（sudoSecret: null）→ 锁定保留', async () => {
      const id = await locked('sudo-auth-failed')
      const dto = await service.save(
        input({ id, secret: undefined, sudoSecret: null, identities: ['app1', 'root'] })
      )
      expect(dto.authState).toBe('sudo-auth-failed')
      expect(pool.disconnect).toHaveBeenCalledWith(id, { keepAuthLock: true, keepSudoLock: true })
      pool.disconnect.mockClear()
      onConnectionReset.mockClear()
      const renamed = await service.save(
        input({
          id,
          name: 'AP1 改',
          secret: undefined,
          sudoSecret: null,
          identities: ['app1', 'root']
        })
      )
      expect(renamed.authState).toBe('sudo-auth-failed')
      expect(pool.disconnect).not.toHaveBeenCalled()
      expect(onConnectionReset).not.toHaveBeenCalled()
    })

    it('R25：auth-failed、私钥认证且无口令：只改名称（secret: ""）→ 锁定保留，不断开、不刷新', async () => {
      const key = { auth: 'key' as const, keyPath: 'C:/keys/id', secret: '' }
      const id = await locked('auth-failed', key)
      const dto = await service.save(input({ id, name: 'AP1 改', ...key }))
      expect(dto.authState).toBe('auth-failed')
      expect(pool.disconnect).not.toHaveBeenCalled()
      expect(onConnectionReset).not.toHaveBeenCalled()
    })

    it('R25：auth-failed、私钥认证：设置了口令 → 解除', async () => {
      const key = { auth: 'key' as const, keyPath: 'C:/keys/id', secret: '' }
      const id = await locked('auth-failed', key)
      const dto = await service.save(input({ id, ...key, secret: 'kp' }))
      expect(dto.authState).toBe('ok')
    })

    it('auth-failed：只改名称 → 锁定保留，不断开、不重新检查条目根', async () => {
      const id = await locked('auth-failed')
      const dto = await service.save(input({ id, name: 'AP1 改', secret: undefined }))
      expect(dto.authState).toBe('auth-failed')
      expect(pool.disconnect).not.toHaveBeenCalled()
      expect(onConnectionReset).not.toHaveBeenCalled()
      expect(emitChanged).toHaveBeenCalledTimes(1)
    })

    it('auth-failed：只改 identities / sftp-server 路径 → 锁定保留；断开时保留内存中的锁定', async () => {
      const id = await locked('auth-failed')
      const dto = await service.save(input({ id, secret: undefined, identities: ['app1', 'root'] }))
      expect(dto.authState).toBe('auth-failed')
      expect(pool.disconnect).toHaveBeenCalledWith(id, { keepAuthLock: true, keepSudoLock: true })
      const dto2 = await service.save(
        input({ id, secret: undefined, sftpServerPath: '/usr/lib/openssh/sftp-server' })
      )
      expect(dto2.authState).toBe('auth-failed')
    })

    it.each([
      ['secret', { secret: 'new-pass' }],
      ['host', { secret: undefined, host: 'ap1b.example' }],
      ['port', { secret: undefined, port: 2222 }],
      ['username', { secret: undefined, username: 'ops2' }],
      ['auth / keyPath', { secret: undefined, auth: 'key' as const, keyPath: 'C:\\k' }]
    ])('auth-failed：改 %s → 解除', async (_what, over) => {
      const id = await locked('auth-failed')
      const dto = await service.save(input({ id, ...over }))
      expect(dto.authState).toBe('ok')
      expect(pool.disconnect).toHaveBeenCalledWith(
        id,
        expect.objectContaining({ keepAuthLock: false })
      )
      expect(onConnectionReset).toHaveBeenCalledWith(id)
    })

    it('auth-failed：只改 sudo 密码 → 登录锁定保留', async () => {
      const id = await locked('auth-failed')
      const dto = await service.save(input({ id, secret: undefined, sudoSecret: 'sp' }))
      expect(dto.authState).toBe('auth-failed')
      expect(pool.disconnect).toHaveBeenCalledWith(id, { keepAuthLock: true, keepSudoLock: false })
    })

    it('sudo-auth-failed：只改名称 / identities → 保留', async () => {
      const id = await locked('sudo-auth-failed')
      expect((await service.save(input({ id, name: 'x', secret: undefined }))).authState).toBe(
        'sudo-auth-failed'
      )
      const dto = await service.save(input({ id, secret: undefined, identities: ['root'] }))
      expect(dto.authState).toBe('sudo-auth-failed')
      expect(pool.disconnect).toHaveBeenLastCalledWith(id, {
        keepAuthLock: true,
        keepSudoLock: true
      })
    })

    it('sudo-auth-failed：改 sudo 密码（含清除）→ 解除', async () => {
      const id = await locked('sudo-auth-failed', { sudoSecret: 'sp' })
      expect(
        (await service.save(input({ id, secret: undefined, sudoSecret: 'sp2' }))).authState
      ).toBe('ok')
      await repo.setAuthState(id, 'sudo-auth-failed')
      expect(
        (await service.save(input({ id, secret: undefined, sudoSecret: null }))).authState
      ).toBe('ok')
    })

    it('sudo-auth-failed：未另设 sudo 密码时改登录密码 → 解除；另设了 sudo 密码时改登录密码 → 保留', async () => {
      const id = await locked('sudo-auth-failed')
      const dto = await service.save(input({ id, secret: 'new-pass' }))
      expect(dto.authState).toBe('ok')
      expect(pool.disconnect).toHaveBeenLastCalledWith(id, {
        keepAuthLock: false,
        keepSudoLock: false
      })
      const id2 = await locked('sudo-auth-failed', { sudoSecret: 'sp' })
      const dto2 = await service.save(input({ id: id2, secret: 'new-pass' }))
      expect(dto2.authState).toBe('sudo-auth-failed')
      expect(pool.disconnect).toHaveBeenLastCalledWith(id2, {
        keepAuthLock: false,
        keepSudoLock: true
      })
    })
  })

  it('delete：先 disconnect 再删除；通知变化', async () => {
    const dto = await service.save(input())
    pool.disconnect.mockClear()
    emitChanged.mockClear()
    await service.delete(dto.id)
    expect(pool.disconnect).toHaveBeenCalledWith(dto.id)
    expect(await repo.get(dto.id)).toBeUndefined()
    expect(emitChanged).toHaveBeenCalledTimes(1)
    expect(onConnectionReset).toHaveBeenLastCalledWith(dto.id)
  })

  it('delete 不存在的连接 → CONN_NOT_FOUND，不断开、不通知', async () => {
    emitChanged.mockClear()
    expect((await errorOf(service.delete('nope'))).code).toBe('CONN_NOT_FOUND')
    expect(pool.disconnect).not.toHaveBeenCalled()
    expect(emitChanged).not.toHaveBeenCalled()
  })

  it('reconnect：unlock、disconnect 与 onConnectionReset', async () => {
    const dto = await service.save(input())
    pool.disconnect.mockClear()
    onConnectionReset.mockClear()
    emitChanged.mockClear()
    await service.reconnect(dto.id)
    expect(pool.unlock).toHaveBeenCalledWith(dto.id)
    expect(pool.disconnect).toHaveBeenCalledWith(dto.id)
    expect(pool.unlock.mock.invocationCallOrder[0]).toBeLessThan(
      pool.disconnect.mock.invocationCallOrder[0]!
    )
    expect(onConnectionReset).toHaveBeenCalledWith(dto.id)
    expect(emitChanged).toHaveBeenCalledTimes(1)
  })

  it('reconnect 不存在的连接 → CONN_NOT_FOUND', async () => {
    expect((await errorOf(service.reconnect('nope'))).code).toBe('CONN_NOT_FOUND')
    expect(pool.unlock).not.toHaveBeenCalled()
  })

  it('trustHostKey：没有出示的新密钥 → CONN_NOT_FOUND，不写库', async () => {
    const dto = await service.save(input())
    await repo.setHostKey(dto.id, KEY)
    expect((await errorOf(service.trustHostKey(dto.id, NEW_KEY))).code).toBe('CONN_NOT_FOUND')
    expect((await repo.get(dto.id))!.hostKey).toEqual(KEY)
  })

  it('I4：trustHostKey 的密钥与服务器最新出示的不一致 → CONN_HOST_KEY_CHANGED，不写库、不断开', async () => {
    const dto = await service.save(input())
    await repo.setHostKey(dto.id, KEY)
    const NEWER: HostKeyInfo = { algorithm: 'ssh-ed25519', fingerprint: 'SHA256:newer' }
    pool.presentedHostKey.mockReturnValue(NEWER)
    pool.disconnect.mockClear()
    emitChanged.mockClear()
    for (const seen of [
      NEW_KEY,
      { algorithm: 'ecdsa-sha2-nistp256', fingerprint: 'SHA256:newer' }
    ]) {
      const e = await errorOf(service.trustHostKey(dto.id, seen))
      expect(e.code).toBe('CONN_HOST_KEY_CHANGED')
    }
    expect((await repo.get(dto.id))!.hostKey).toEqual(KEY)
    expect(pool.disconnect).not.toHaveBeenCalled()
    expect(emitChanged).not.toHaveBeenCalled()
    await service.trustHostKey(dto.id, NEWER)
    expect((await repo.get(dto.id))!.hostKey).toEqual(NEWER)
  })

  it('trustHostKey：先读出示的密钥，再写库，再 disconnect（disconnect 会清除出示的密钥）', async () => {
    const dto = await service.save(input())
    await repo.setHostKey(dto.id, KEY)
    let presented: HostKeyInfo | null = NEW_KEY
    pool.presentedHostKey.mockImplementation(() => presented)
    pool.disconnect.mockImplementation(() => {
      presented = null
    })
    pool.disconnect.mockClear()
    onConnectionReset.mockClear()
    emitChanged.mockClear()
    await service.trustHostKey(dto.id, NEW_KEY)
    expect((await repo.get(dto.id))!.hostKey).toEqual(NEW_KEY)
    expect(pool.disconnect).toHaveBeenCalledWith(dto.id)
    expect(onConnectionReset).toHaveBeenCalledWith(dto.id)
    expect(emitChanged).toHaveBeenCalledTimes(1)
  })

  it('test：交给连接池，之后通知变化（锁定状态可能改变）', async () => {
    const dto = await service.save(input())
    emitChanged.mockClear()
    pool.test.mockResolvedValue({ steps: [{ step: 'connect', ok: true }] })
    await expect(service.test(dto.id)).resolves.toEqual({
      steps: [{ step: 'connect', ok: true }]
    })
    expect(pool.test).toHaveBeenCalledWith(dto.id)
    expect(emitChanged).toHaveBeenCalledTimes(1)
  })

  it('test 之后 onConnectionReset（测试可能解除了锁定，条目根立即重新检查）', async () => {
    const dto = await service.save(input())
    onConnectionReset.mockClear()
    await service.test(dto.id)
    expect(onConnectionReset).toHaveBeenCalledWith(dto.id)
    expect(pool.test.mock.invocationCallOrder[0]).toBeLessThan(
      onConnectionReset.mock.invocationCallOrder[0]!
    )
  })

  it('C1（真实连接池）：锁定后只改名称 / identities 并保存 → 之后的读取不拨号；改密码 → 拨号', async () => {
    const connect = vi.fn(async (): Promise<SshSession> => {
      throw new AppError({ code: 'CONN_AUTH_FAILED', detail: 'client-authentication' })
    })
    const realPool = new ConnectionPool({
      repo,
      secrets,
      connect,
      openIdentity: vi.fn() as unknown as PoolDeps['openIdentity'],
      bridge: vi.fn() as unknown as PoolDeps['bridge'],
      readKeyFile: async () => Buffer.alloc(0),
      hostKeys: { ask: async () => true, answer: () => undefined, pending: () => [] },
      settings: () => ({ keepaliveSec: 15, idleDisconnectMin: 5, timeoutSec: 20 }),
      onStatus: () => undefined,
      now: () => clock,
      setTimer: setTimeout,
      clearTimer: clearTimeout,
      log: silent
    })
    // 组合根的 onConnectionReset：重新检查条目根 = 以用户操作读取
    const reads: Promise<unknown>[] = []
    service = new ConnectionService({
      repo,
      secrets,
      pool: realPool,
      emitChanged,
      onConnectionReset: (id) => {
        const p = realPool.session(
          { connectionId: id, identity: null },
          { userAction: true, signal: new AbortController().signal }
        )
        p.catch(() => undefined)
        reads.push(p)
      },
      now: () => clock
    })
    const dto = await service.save(input())
    await Promise.allSettled(reads)
    expect(connect).toHaveBeenCalledTimes(1)
    expect((await repo.get(dto.id))!.authState).toBe('auth-failed')

    await service.save(input({ id: dto.id, name: 'AP1 改', secret: undefined }))
    await service.save(input({ id: dto.id, secret: undefined, identities: ['app1', 'root'] }))
    await Promise.allSettled(reads)
    expect(connect).toHaveBeenCalledTimes(1)
    expect((await repo.get(dto.id))!.authState).toBe('auth-failed')

    await service.save(input({ id: dto.id, secret: 'new-pass' }))
    await Promise.allSettled(reads)
    expect(connect).toHaveBeenCalledTimes(2)
    await realPool.dispose()
  })

  it('home：按连接与身份取连接池的 home', async () => {
    const dto = await service.save(input())
    await expect(service.home(dto.id, null)).resolves.toBe('/home/ops')
    expect(pool.home.mock.calls[0]![0]).toEqual({ connectionId: dto.id, identity: null })
    expect(pool.home.mock.calls[0]![1]).toBeInstanceOf(AbortSignal)
    await service.home(dto.id, 'app1')
    expect(pool.home.mock.calls[1]![0]).toEqual({ connectionId: dto.id, identity: 'app1' })
  })
})
