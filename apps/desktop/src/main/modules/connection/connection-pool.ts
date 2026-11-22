// 连接池（设计 devDoc/2026-11-22-37-m4-sftp-design.md 第 5.2–5.4 节）。
// 反目标：认证失败被自动重试导致账号被锁；主机密钥未经用户确认被接受。
//
// 并发共享：
// - SSH 连接按 connectionId 懒建立，并发请求共享同一个连接尝试（Promise）；请求被取消只让该请求离开，
//   不中止共享的尝试（主机密钥确认框与其他等待者仍在），尝试本身受 readyTimeout 约束。
// - 登录用户的 SFTP 子系统按连接共享；切换身份的会话见 identity-sessions.ts（ConnIdentities）。
// 锁定：认证失败写 auth_state（跨重启），同时记在内存（写库失败或与并发请求竞争时也不再提交凭据）。
import {
  AppError,
  type ConnectionAuthState,
  type ConnectionState,
  type ConnectionTestResult,
  type ConnectionTestStep,
  type HostKeyInfo
} from '@pch/shared'
import type { Logger } from '../../infra/logger'
import type { SftpSession, SftpSessionSource, SftpTarget } from '../../vfs/providers/sftp.provider'
import type { ConnectionRecord, ConnectionRepo } from './connection.repo'
import { sameLoginCredentials, sameSudoCredentials } from './credentials'
import type { HostKeyGate } from './host-key-gate'
import {
  cancelled,
  ConnIdentities,
  decryptSecret,
  IdentityMemory,
  raceSignal,
  testIdentitySteps,
  toAppError,
  type IdentityDeps
} from './identity-sessions'
import type { SecretBox } from './secret-box'
import type { sftpOverChannel } from './sftp-bridge'
import type { SshAuth, SshConnectConfig, SshSession } from './ssh-session'
import type { openIdentityChannel } from './sudo-switch'

export interface PoolDeps {
  repo: Pick<ConnectionRepo, 'get' | 'setAuthState' | 'setHostKey'>
  secrets: SecretBox
  connect: (cfg: SshConnectConfig) => Promise<SshSession> // 生产为 connectSsh
  openIdentity: typeof openIdentityChannel
  bridge: typeof sftpOverChannel
  readKeyFile: (path: string) => Promise<Buffer>
  hostKeys: HostKeyGate
  settings: () => { keepaliveSec: number; idleDisconnectMin: number; timeoutSec: number }
  onStatus: (connectionId: string, state: ConnectionState) => void
  now: () => number
  setTimer: typeof setTimeout
  clearTimer: typeof clearTimeout
  log: Logger
}

/** 首次连接（需要用户确认主机密钥）时 readyTimeout 的下限：计时包含用户确认的时间（R5） */
const FIRST_CONNECT_READY_MS = 300_000
/**
 * dispose 等待进行中的连接尝试 / 身份打开结束（及其锁定写入）的上限：确认框未回答、TCP 连接未超时的尝试
 * 可能要几分钟才结束，不能让退出一直等
 */
const DISPOSE_WAIT_MS = 5_000

type Timer = ReturnType<typeof setTimeout>

interface LoginEntry {
  promise: Promise<SftpSession>
  wrapper: SftpSession | null
}

interface Conn {
  id: string
  ready: Promise<SshSession>
  /** 已从池中移除（断开 / 空闲 / 连接关闭）：之后完成的连接尝试立即关闭其结果 */
  discarded: boolean
  ssh: SshSession | null
  login: LoginEntry | null
  identities: ConnIdentities | null
  /** 进行中的 session() 调用与会话请求数；大于 0 时不空闲断开 */
  active: number
  lastUsed: number
  idleTimer: Timer | null
}

interface Owner {
  conn: Conn
  identity: string | null
}

/** 一次连接尝试（池的尝试或 test() 的拨号）；dialed：拨号时读到的记录（拨号之前失败为 null） */
interface Attempt {
  promise: Promise<SshSession>
  dialed: ConnectionRecord | null
}

interface DialHooks {
  /** 状态变化（host-key-pending / connecting） */
  onState?(state: ConnectionState): void
  /** 服务器出示了主机密钥（TCP 与密钥交换已完成） */
  onReached?(): void
  /** 主机密钥检查结果：null = 通过 */
  onHostKey?(error: AppError | null): void
}

const sameKey = (a: HostKeyInfo, b: HostKeyInfo): boolean =>
  a.algorithm === b.algorithm && a.fingerprint === b.fingerprint

/** 「服务器没有可用的认证方式」：没有提交任何凭据，不锁定（ssh-session 的 noMethod） */
const isNoMethod = (e: AppError): boolean =>
  e.code === 'CONN_AUTH_FAILED' && (e.detail ?? '').startsWith('no acceptable method')

/** 交出了凭据且认证失败（不是锁定中拒绝拨号、也不是没有可用的认证方式） */
const isCredentialFailure = (e: AppError): boolean =>
  e.code === 'CONN_AUTH_FAILED' && e.detail !== 'locked' && !isNoMethod(e)

const disposedError = (): AppError =>
  new AppError({ code: 'FS_UNAVAILABLE', detail: 'pool disposed' })

export class ConnectionPool implements SftpSessionSource {
  private readonly conns = new Map<string, Conn>()
  private readonly states = new Map<string, ConnectionState>()
  private readonly presented = new Map<string, HostKeyInfo>()
  /** 内存中的登录认证锁定（与 auth_state 同时写） */
  private readonly authLocked = new Set<string>()
  /** 主机密钥被拒绝 / 确认超时 / 没有窗口（R13）：后台请求不再询问，用户操作才重新询问 */
  private readonly untrusted = new Set<string>()
  /** R12 / C2：connectionId → 进行中的连接尝试（含已被丢弃的与 test() 的拨号） */
  private readonly attempts = new Map<string, Attempt>()
  /** 进行中的 test()（dispose 等它们结束） */
  private readonly tests = new Set<Promise<unknown>>()
  private readonly memory: IdentityMemory
  private readonly identityDeps: IdentityDeps
  private readonly owners = new WeakMap<SftpSession, Owner>()
  /** 进行中的 auth_state 写入（dispose 等它们结束后才返回，之后才关闭数据库） */
  private readonly writes = new Set<Promise<void>>()
  private disposed = false

  constructor(private readonly deps: PoolDeps) {
    this.memory = new IdentityMemory(() => deps.now())
    this.identityDeps = {
      repo: deps.repo,
      secrets: deps.secrets,
      openIdentity: deps.openIdentity,
      bridge: deps.bridge,
      log: deps.log,
      memory: this.memory,
      lockSudo: async (id, opened) => {
        // 打开身份之后 sudo 凭据被编辑过：失败的是旧的凭据，不覆盖编辑的结果（C1）
        const cur = await deps.repo.get(id).catch(() => opened)
        if (cur === undefined || !sameSudoCredentials(cur, opened)) return
        this.memory.lockSudo(id)
        await this.writeAuthState(id, 'sudo-auth-failed')
      }
    }
  }

  // ---- 公开接口 ----

  async session(
    target: SftpTarget,
    opts: { userAction: boolean; signal: AbortSignal }
  ): Promise<SftpSession> {
    const { connectionId: id, identity } = target
    const { signal } = opts
    if (signal.aborted) throw cancelled()
    if (this.disposed) throw disposedError()
    const rec = await this.deps.repo.get(id)
    if (!rec) throw new AppError({ code: 'CONN_NOT_FOUND' })
    // 身份必须在该连接登记的 identities 中（编辑删去的身份随之不可用）：不连接、不执行 sudo
    if (identity !== null && !rec.identities.includes(identity)) {
      throw new AppError({ code: 'IPC_FORBIDDEN', detail: 'identity not registered' })
    }
    if (rec.authState === 'auth-failed' || this.authLocked.has(id)) {
      this.setState(id, 'auth-failed')
      throw new AppError({ code: 'CONN_AUTH_FAILED', detail: 'locked' })
    }
    if (identity !== null) {
      if (rec.authState === 'sudo-auth-failed' || this.memory.sudoLocked.has(id)) {
        throw new AppError({ code: 'CONN_SUDO_AUTH_FAILED', detail: 'locked' })
      }
      this.memory.checkFailure(id, identity, opts.userAction)
    }
    if (this.untrusted.has(id) && !this.conns.has(id)) {
      if (!opts.userAction) {
        throw new AppError({ code: 'CONN_HOST_KEY_REJECTED', detail: 'not trusted' })
      }
      this.untrusted.delete(id)
    }

    const conn = this.ensureConn(id)
    conn.active++
    this.clearIdle(conn)
    try {
      const ssh = await raceSignal(conn.ready, signal)
      // 等待期间连接被丢弃（断线 / 空闲 / 编辑）：不在它上面建立会话（Minor 8）
      if (conn.discarded) throw new AppError({ code: 'FS_UNAVAILABLE', detail: 'disconnected' })
      if (identity === null) return await raceSignal(this.loginSftp(conn, ssh), signal)
      conn.identities ??= new ConnIdentities(
        id,
        ssh,
        this.identityDeps,
        (ident, s) => this.wrap(conn, ident, s),
        (fn) => this.busy(conn, fn)
      )
      return await conn.identities.session(identity, signal)
    } finally {
      conn.active--
      this.touch(conn)
    }
  }

  invalidate(target: SftpTarget, session: SftpSession): void {
    const owner = this.owners.get(session)
    if (!owner || owner.identity !== target.identity) return
    const { conn, identity } = owner
    if (identity === null) {
      if (conn.login?.wrapper === session) conn.login = null
    } else {
      conn.identities?.invalidate(identity, session)
    }
  }

  state(connectionId: string): ConnectionState {
    return this.states.get(connectionId) ?? 'idle'
  }

  presentedHostKey(connectionId: string): HostKeyInfo | null {
    return this.presented.get(connectionId) ?? null
  }

  /**
   * keepAuthLock / keepSudoLock：编辑没有改对应的凭据时保留内存中的锁定（C1；auth_state 写入失败时
   * 锁定只在内存中，不能因编辑名称等而丢失）
   */
  disconnect(
    connectionId: string,
    opts: { keepAuthLock?: boolean; keepSudoLock?: boolean } = {}
  ): void {
    const conn = this.conns.get(connectionId)
    if (conn) void this.teardown(conn)
    // 编辑 / 删除 / 重新连接都是用户的明确操作：内存中的记忆一并清除（持久的锁定以 auth_state 为准）
    this.memory.clearFailures(connectionId)
    this.memory.clearModes(connectionId)
    if (!opts.keepSudoLock) this.memory.sudoLocked.delete(connectionId)
    if (!opts.keepAuthLock) this.authLocked.delete(connectionId)
    this.untrusted.delete(connectionId)
    this.presented.delete(connectionId)
    this.setState(connectionId, 'idle')
  }

  async unlock(connectionId: string): Promise<void> {
    await this.deps.repo.setAuthState(connectionId, 'ok')
    this.authLocked.delete(connectionId)
    this.untrusted.delete(connectionId)
    this.memory.sudoLocked.delete(connectionId)
    this.memory.clearFailures(connectionId)
    if (this.state(connectionId) === 'auth-failed') this.setState(connectionId, 'idle')
  }

  async home(target: SftpTarget, signal: AbortSignal): Promise<string> {
    if (target.identity !== null) return '/'
    const s = await this.session(target, { userAction: true, signal })
    return s.realpath('.', signal)
  }

  /**
   * 「测试连接」（D3：锁定中也尝试一次）。C2：与池的连接尝试串行——先等进行中的尝试结束；那次尝试交出了
   * 凭据并认证失败（且之后凭据没有被编辑）时，直接以它作为 auth 步骤的结果、不再拨号（否则用户输错一次，
   * 服务器记 2 次）。测试的拨号也登记为连接尝试，池随后的尝试等它结束、再读锁定。
   * 身份步骤与池的身份打开共用按连接的 sudo 互斥（IdentityMemory.withSudoTurn）
   */
  async test(connectionId: string): Promise<ConnectionTestResult> {
    if (this.disposed) throw disposedError()
    const run = this.runTest(connectionId)
    this.tests.add(run)
    void run.then(
      () => this.tests.delete(run),
      () => this.tests.delete(run)
    )
    return run
  }

  private async runTest(connectionId: string): Promise<ConnectionTestResult> {
    const first = await this.deps.repo.get(connectionId)
    if (!first) throw new AppError({ code: 'CONN_NOT_FOUND' })
    // 测试开始之后发生的 sudo 锁定（池的身份打开失败）：测试不再交出 sudo 密码
    const sudoGen = this.memory.sudoLockGen(connectionId)
    const steps: ConnectionTestStep[] = []
    const fail = (step: ConnectionTestStep['step'], e: unknown): void => {
      steps.push({ step, ok: false, error: toAppError(e).toPayload() })
    }

    let reached = false
    let hostKeyOk: boolean | null = null
    let reused: AppError | null = null
    const mine: Attempt = { promise: Promise.resolve(null as unknown as SshSession), dialed: null }
    const prev = this.attempts.get(connectionId)
    mine.promise = (async (): Promise<SshSession> => {
      if (prev) {
        const prevError = await prev.promise.then(
          () => null,
          (e: unknown) => toAppError(e)
        )
        if (
          prevError &&
          isCredentialFailure(prevError) &&
          prev.dialed &&
          (await this.unchangedSince(prev.dialed))
        ) {
          reused = prevError
          throw prevError
        }
      }
      if (this.disposed) throw disposedError()
      // 等待之后重新读取：凭据以最新为准
      const rec = await this.deps.repo.get(connectionId)
      if (!rec) throw new AppError({ code: 'CONN_NOT_FOUND' })
      mine.dialed = rec
      try {
        return await this.dial(rec, {
          onReached: () => {
            if (reached) return
            reached = true
            steps.push({ step: 'connect', ok: true })
          },
          onHostKey: (e) => {
            hostKeyOk = e === null
            if (e) fail('hostKey', e)
            else steps.push({ step: 'hostKey', ok: true })
          }
        })
      } catch (e) {
        const err = toAppError(e)
        // 锁定在本尝试结束之前写入：池随后的尝试等它结束后重新读取，看到锁定不再拨号。
        // 拨号之后凭据被编辑过：失败的是旧的凭据，不锁定（C1）
        if (isCredentialFailure(err) && (await this.unchangedSince(rec))) {
          await this.lockAuth(connectionId)
        }
        throw err
      }
    })()
    this.track(connectionId, mine)

    let ssh: SshSession
    try {
      ssh = await mine.promise
    } catch (e) {
      const err = toAppError(e)
      if (reused) {
        // 池的尝试已到达服务器并通过了主机密钥检查（认证失败只发生在其后）；锁定已由池写入
        steps.push({ step: 'connect', ok: true }, { step: 'hostKey', ok: true })
        fail('auth', reused)
        return { steps }
      }
      if (!reached) {
        // 私钥 / 机密的问题发生在连接之前
        const local = err.code === 'CONN_KEY_INVALID' || err.code === 'CONN_SECRET_UNAVAILABLE'
        fail(local ? 'auth' : 'connect', err)
      } else if (hostKeyOk === null) {
        fail('hostKey', err)
      } else if (hostKeyOk) {
        fail('auth', err)
      }
      if (!this.conns.has(connectionId)) {
        // 池中没有连接时，状态反映测试的结果
        if (err.code === 'CONN_AUTH_FAILED' && !isNoMethod(err))
          this.setState(connectionId, 'auth-failed')
        if (err.code === 'CONN_HOST_KEY_CHANGED') this.setState(connectionId, 'host-key-changed')
      }
      return { steps }
    }

    try {
      steps.push({ step: 'auth', ok: true })
      this.presented.delete(connectionId)
      // 登录认证已成功：内存中的登录锁定与 auth-failed 状态立即解除（身份步骤的结果另行处理）
      this.authLocked.delete(connectionId)
      if (this.state(connectionId) === 'auth-failed') this.setState(connectionId, 'idle')
      await this.testSftp(ssh, steps)
      const rec = mine.dialed ?? first
      const sudoAuthFailed = await testIdentitySteps(rec, ssh, this.identityDeps, steps, sudoGen)
      // sudo 认证失败已由 testIdentitySteps 锁定；其余情况解除锁定
      if (!sudoAuthFailed) {
        this.memory.sudoLocked.delete(connectionId)
        if (rec.authState !== 'ok') await this.writeAuthState(connectionId, 'ok')
      }
      return { steps }
    } finally {
      ssh.close()
    }
  }

  /**
   * 关闭全部连接。中止进行中的身份打开（已交出 sudo 密码）与之后才失败的连接尝试会异步写入锁定状态：
   * 等它们结束（上限 DISPOSE_WAIT_MS）与已开始的写入完成后再返回（调用方随后关闭数据库）
   */
  async dispose(): Promise<void> {
    this.disposed = true
    const pending: Promise<unknown>[] = [...this.attempts.values()].map((a) => a.promise)
    pending.push(...this.tests)
    for (const conn of [...this.conns.values()]) pending.push(this.teardown(conn))
    await this.settleWithin(pending, DISPOSE_WAIT_MS)
    while (this.writes.size > 0) await Promise.allSettled([...this.writes])
  }

  // ---- SSH 连接 ----

  private ensureConn(id: string): Conn {
    const existing = this.conns.get(id)
    if (existing) return existing
    const conn: Conn = {
      id,
      ready: Promise.resolve(null as unknown as SshSession),
      discarded: false,
      ssh: null,
      login: null,
      identities: null,
      active: 0,
      lastUsed: this.deps.now(),
      idleTimer: null
    }
    this.conns.set(id, conn)
    conn.ready = this.open(conn)
    conn.ready.catch(() => undefined)
    return conn
  }

  /**
   * R12：同一连接同时只有一个连接尝试（含已被 disconnect 丢弃、仍在进行的）。新的尝试先等旧的结束，
   * 再重新读取记录与锁定——否则 disconnect 之后的请求会立即以同一（可能错误的）密码再拨一次
   */
  private open(conn: Conn): Promise<SshSession> {
    const id = conn.id
    this.setState(id, 'connecting')
    const prev = this.attempts.get(id)
    const mine: Attempt = { promise: Promise.resolve(null as unknown as SshSession), dialed: null }
    mine.promise = (async (): Promise<SshSession> => {
      if (prev) await prev.promise.catch(() => undefined)
      return this.attempt(conn, mine)
    })()
    this.track(id, mine)
    return mine.promise
  }

  /** 登记为该连接最新的尝试；结束后若仍是最新的则移除 */
  private track(id: string, a: Attempt): void {
    this.attempts.set(id, a)
    void a.promise
      .catch(() => undefined)
      .finally(() => {
        if (this.attempts.get(id) === a) this.attempts.delete(id)
      })
  }

  private async attempt(conn: Conn, me: Attempt): Promise<SshSession> {
    const id = conn.id
    let locked = false
    let dialed: ConnectionRecord | null = null
    try {
      if (conn.discarded) throw new AppError({ code: 'FS_UNAVAILABLE', detail: 'disconnected' })
      // 重新读取：与之前失败的尝试竞争的请求在这里看到锁定，不再提交凭据
      const rec = await this.deps.repo.get(id)
      if (!rec) throw new AppError({ code: 'CONN_NOT_FOUND' })
      if (rec.authState === 'auth-failed' || this.authLocked.has(id)) {
        locked = true
        throw new AppError({ code: 'CONN_AUTH_FAILED', detail: 'locked' })
      }
      dialed = rec
      me.dialed = rec
      const ssh = await this.dial(rec, {
        onState: (s) => {
          if (!conn.discarded) this.setState(id, s)
        }
      })
      if (conn.discarded) {
        ssh.close()
        throw new AppError({ code: 'FS_UNAVAILABLE', detail: 'disconnected' })
      }
      conn.ssh = ssh
      this.presented.delete(id)
      ssh.onClose((err) => this.onSshClosed(conn, err))
      this.deps.log.info(`connection ${id}: online`)
      this.setState(id, 'online')
      // 等待者都已离开（取消）时也要开始空闲计时，否则连接永不断开
      if (conn.active === 0) this.touch(conn)
      return ssh
    } catch (e) {
      const err = toAppError(e)
      if (this.conns.get(id) === conn) this.conns.delete(id)
      if (!conn.discarded) {
        conn.discarded = true
        if (locked) this.setState(id, 'auth-failed')
        else await this.connectFailed(id, err, dialed)
      } else if (err.code === 'CONN_AUTH_FAILED' && !locked && !isNoMethod(err)) {
        // 尝试中途被 disconnect：凭据已提交并失败，仍要锁定（否则下一次请求以同一密码再试）；
        // 但记录在拨号之后被编辑过时，失败的是旧的凭据，不覆盖编辑的结果
        if (dialed && (await this.unchangedSince(dialed))) await this.lockAuth(id)
      }
      throw err
    }
  }

  /** 建立一次 SSH 连接（池与 test() 共用）：凭据准备、主机密钥检查 */
  private async dial(rec: ConnectionRecord, hooks: DialHooks): Promise<SshSession> {
    const auth = await this.loginAuth(rec)
    const { keepaliveSec, timeoutSec } = this.deps.settings()
    const id = rec.id
    const trusted = rec.hostKey
    return this.deps.connect({
      host: rec.host,
      port: rec.port,
      username: rec.username,
      auth,
      keepaliveSec,
      readyTimeoutMs:
        trusted === null ? Math.max(timeoutSec * 1000, FIRST_CONNECT_READY_MS) : timeoutSec * 1000,
      verifyHostKey: async (key) => {
        hooks.onReached?.()
        if (trusted !== null) {
          if (sameKey(trusted, key)) {
            hooks.onHostKey?.(null)
            return true
          }
          // 不一致：不询问，记下新密钥（只能由用户明确「信任新的密钥」）
          this.presented.set(id, key)
          const e = new AppError({ code: 'CONN_HOST_KEY_CHANGED', detail: key.fingerprint })
          hooks.onHostKey?.(e)
          throw e
        }
        hooks.onState?.('host-key-pending')
        const ok = await this.deps.hostKeys.ask(id, key).catch(() => false)
        hooks.onState?.('connecting')
        if (ok) this.untrusted.delete(id)
        else this.untrusted.add(id)
        if (!ok) {
          const e = new AppError({ code: 'CONN_HOST_KEY_REJECTED', detail: key.fingerprint })
          hooks.onHostKey?.(e)
          throw e
        }
        await this.deps.repo.setHostKey(id, key)
        hooks.onHostKey?.(null)
        return true
      }
    })
  }

  /** 登录凭据；私钥读不了 / 机密解不开 → 不连接、不锁定 */
  private async loginAuth(rec: ConnectionRecord): Promise<SshAuth> {
    const { secrets } = this.deps
    if (rec.auth === 'key') {
      if (rec.keyPath === null) {
        throw new AppError({ code: 'CONN_KEY_INVALID', detail: 'no key file' })
      }
      let privateKey: Buffer
      try {
        privateKey = await this.deps.readKeyFile(rec.keyPath)
      } catch (e) {
        const code = (e as { code?: unknown } | null)?.code
        throw new AppError({
          code: 'CONN_KEY_INVALID',
          detail: `read key file: ${typeof code === 'string' ? code : 'failed'}`
        })
      }
      if (rec.secret === null) return { kind: 'key', privateKey }
      return { kind: 'key', privateKey, passphrase: decryptSecret(secrets, rec.secret) }
    }
    // 没有保存密码时不以空密码尝试（会在服务器上记一次失败）
    if (rec.secret === null) {
      throw new AppError({ code: 'CONN_SECRET_UNAVAILABLE', detail: 'no password saved' })
    }
    return { kind: 'password', password: decryptSecret(secrets, rec.secret) }
  }

  /**
   * 拨号时的登录凭据之后没有被编辑（R12 / C1：比较凭据相关字段，不比较 updatedAt——拨号中途只改名称时
   * 错误的密码仍要锁定）。读取失败时按「未编辑」处理（偏向锁定）；记录已删除时无需锁定
   */
  private async unchangedSince(dialed: ConnectionRecord): Promise<boolean> {
    const cur = await this.deps.repo.get(dialed.id).catch(() => dialed)
    return cur !== undefined && sameLoginCredentials(cur, dialed)
  }

  private async connectFailed(
    id: string,
    err: AppError,
    dialed: ConnectionRecord | null
  ): Promise<void> {
    this.deps.log.warn(`connection ${id}: connect failed (${err.code})`)
    switch (err.code) {
      case 'CONN_AUTH_FAILED':
        if (isNoMethod(err)) return this.setState(id, 'idle')
        if (dialed && !(await this.unchangedSince(dialed))) return this.setState(id, 'idle')
        await this.lockAuth(id)
        return this.setState(id, 'auth-failed')
      case 'CONN_HOST_KEY_CHANGED':
        return this.setState(id, 'host-key-changed')
      case 'FS_UNAVAILABLE':
      case 'FS_TIMEOUT':
      case 'UNKNOWN':
        return this.setState(id, 'offline')
      default:
        return this.setState(id, 'idle')
    }
  }

  private async lockAuth(id: string): Promise<void> {
    this.authLocked.add(id)
    await this.writeAuthState(id, 'auth-failed')
  }

  private writeAuthState(id: string, state: ConnectionAuthState): Promise<void> {
    const p = (async (): Promise<void> => {
      try {
        await this.deps.repo.setAuthState(id, state)
      } catch (e) {
        this.deps.log.error(
          `connection ${id}: write auth_state ${state} failed (${toAppError(e).code})`
        )
      }
    })()
    this.writes.add(p)
    void p.finally(() => this.writes.delete(p))
    return p
  }

  /** 等这些 Promise 全部结束，最多 ms 毫秒 */
  private async settleWithin(ps: Promise<unknown>[], ms: number): Promise<void> {
    if (ps.length === 0) return
    let timer: Timer | undefined
    const cap = new Promise<void>((resolve) => {
      timer = this.deps.setTimer(resolve, ms)
      ;(timer as { unref?: () => void }).unref?.()
    })
    try {
      await Promise.race([Promise.allSettled(ps), cap])
    } finally {
      if (timer !== undefined) this.deps.clearTimer(timer)
    }
  }

  private onSshClosed(conn: Conn, err: AppError | null): void {
    if (this.conns.get(conn.id) !== conn) return
    void this.teardown(conn)
    this.memory.clearTransientFailures(conn.id)
    this.deps.log.info(`connection ${conn.id}: closed (${err ? err.code : 'normal'})`)
    this.setState(conn.id, err ? 'offline' : 'idle')
  }

  /** 从池中移除并关闭连接与全部身份通道；返回被中止的身份打开过程全部结束的 Promise */
  private teardown(conn: Conn): Promise<void> {
    if (this.conns.get(conn.id) === conn) this.conns.delete(conn.id)
    conn.discarded = true
    this.clearIdle(conn)
    const closing = conn.identities?.close() ?? Promise.resolve()
    conn.identities = null
    conn.login = null
    conn.ssh?.close()
    return closing
  }

  // ---- 空闲断开 ----

  private touch(conn: Conn): void {
    conn.lastUsed = this.deps.now()
    if (conn.active === 0 && !conn.discarded && conn.ssh !== null) {
      this.scheduleIdle(conn, this.idleMs())
    }
  }

  private idleMs(): number {
    return this.deps.settings().idleDisconnectMin * 60_000
  }

  private scheduleIdle(conn: Conn, ms: number): void {
    this.clearIdle(conn)
    const t = this.deps.setTimer(() => this.idleCheck(conn), ms)
    ;(t as { unref?: () => void }).unref?.()
    conn.idleTimer = t
  }

  private clearIdle(conn: Conn): void {
    if (conn.idleTimer !== null) this.deps.clearTimer(conn.idleTimer)
    conn.idleTimer = null
  }

  private idleCheck(conn: Conn): void {
    conn.idleTimer = null
    if (this.conns.get(conn.id) !== conn || conn.active > 0) return
    const left = this.idleMs() - (this.deps.now() - conn.lastUsed)
    if (left > 0) return this.scheduleIdle(conn, left)
    void this.teardown(conn)
    this.memory.clearTransientFailures(conn.id)
    this.deps.log.info(`connection ${conn.id}: idle disconnect`)
    this.setState(conn.id, 'idle')
  }

  /** fn 执行期间记为进行中（不空闲断开），结束后重新开始空闲计时 */
  private async busy<T>(conn: Conn, fn: () => Promise<T>): Promise<T> {
    conn.active++
    this.clearIdle(conn)
    try {
      return await fn()
    } finally {
      conn.active--
      this.touch(conn)
    }
  }

  /** 会话包装：记录进行中的请求与时刻（空闲判断），并用于 invalidate 找到归属 */
  private wrap(conn: Conn, identity: string | null, s: SftpSession): SftpSession {
    const run = <T>(fn: () => Promise<T>): Promise<T> => this.busy(conn, fn)
    const w: SftpSession = {
      stat: (p, sig) => run(() => s.stat(p, sig)),
      lstat: (p, sig) => run(() => s.lstat(p, sig)),
      readdir: (p, sig) => run(() => s.readdir(p, sig)),
      realpath: (p, sig) => run(() => s.realpath(p, sig))
    }
    this.owners.set(w, { conn, identity })
    return w
  }

  // ---- 登录用户的 SFTP ----

  private loginSftp(conn: Conn, ssh: SshSession): Promise<SftpSession> {
    if (conn.login) return conn.login.promise
    const entry: LoginEntry = {
      promise: Promise.resolve(null as unknown as SftpSession),
      wrapper: null
    }
    entry.promise = this.sftpWithin(ssh).then(
      (raw) => {
        entry.wrapper = this.wrap(conn, null, raw)
        return entry.wrapper
      },
      (e: unknown) => {
        if (conn.login === entry) conn.login = null
        throw toAppError(e)
      }
    )
    entry.promise.catch(() => undefined)
    conn.login = entry
    return entry.promise
  }

  /**
   * 打开 SFTP 子系统，以 timeoutSec 为上限（Minor 3：ssh2 的 sftp() 没有超时，服务器不回应时永远挂起）。
   * 超时 → FS_TIMEOUT；之后才就绪的会话被丢弃（不使用；通道随 SSH 连接关闭）
   */
  private sftpWithin(ssh: SshSession): Promise<SftpSession> {
    return new Promise<SftpSession>((resolve, reject) => {
      let done = false
      const timer = this.deps.setTimer(() => {
        if (done) return
        done = true
        reject(new AppError({ code: 'FS_TIMEOUT', detail: 'sftp subsystem' }))
      }, this.deps.settings().timeoutSec * 1000)
      ssh.sftp().then(
        (s) => {
          if (done) return
          done = true
          this.deps.clearTimer(timer)
          resolve(s)
        },
        (e: unknown) => {
          if (done) return
          done = true
          this.deps.clearTimer(timer)
          reject(toAppError(e))
        }
      )
    })
  }

  // ---- test() 与状态 ----

  private async testSftp(ssh: SshSession, steps: ConnectionTestStep[]): Promise<void> {
    const ctrl = new AbortController()
    const timer = this.deps.setTimer(() => ctrl.abort(), this.deps.settings().timeoutSec * 1000)
    try {
      const sftp = await this.sftpWithin(ssh)
      const home = await sftp.realpath('.', ctrl.signal)
      steps.push({ step: 'sftp', ok: true, info: { home } })
    } catch (e) {
      const err = ctrl.signal.aborted ? new AppError({ code: 'FS_TIMEOUT' }) : toAppError(e)
      steps.push({ step: 'sftp', ok: false, error: err.toPayload() })
    } finally {
      this.deps.clearTimer(timer)
    }
  }

  private setState(id: string, state: ConnectionState): void {
    if (this.state(id) === state) return
    this.states.set(id, state)
    this.deps.log.debug(`connection ${id}: state ${state}`)
    this.deps.onStatus(id, state)
  }
}
