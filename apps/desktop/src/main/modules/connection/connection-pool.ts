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

export class ConnectionPool implements SftpSessionSource {
  private readonly conns = new Map<string, Conn>()
  private readonly states = new Map<string, ConnectionState>()
  private readonly presented = new Map<string, HostKeyInfo>()
  /** 内存中的登录认证锁定（与 auth_state 同时写） */
  private readonly authLocked = new Set<string>()
  /** 主机密钥被拒绝 / 确认超时 / 没有窗口（R13）：后台请求不再询问，用户操作才重新询问 */
  private readonly untrusted = new Set<string>()
  /** R12：connectionId → 进行中的连接尝试（含已被丢弃的） */
  private readonly attempts = new Map<string, Promise<SshSession>>()
  private readonly memory = new IdentityMemory()
  private readonly identityDeps: IdentityDeps
  private readonly owners = new WeakMap<SftpSession, Owner>()
  /** 进行中的 auth_state 写入（dispose 等它们结束后才返回，之后才关闭数据库） */
  private readonly writes = new Set<Promise<void>>()
  private disposed = false

  constructor(private readonly deps: PoolDeps) {
    this.identityDeps = {
      repo: deps.repo,
      secrets: deps.secrets,
      openIdentity: deps.openIdentity,
      bridge: deps.bridge,
      log: deps.log,
      memory: this.memory,
      lockSudo: async (id) => {
        this.memory.sudoLocked.add(id)
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
    if (this.disposed) throw new AppError({ code: 'FS_UNAVAILABLE', detail: 'pool disposed' })
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
      if (identity === null) return await raceSignal(this.loginSftp(conn, ssh), signal)
      conn.identities ??= new ConnIdentities(id, ssh, this.identityDeps, (ident, s) =>
        this.wrap(conn, ident, s)
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

  disconnect(connectionId: string): void {
    const conn = this.conns.get(connectionId)
    if (conn) void this.teardown(conn)
    // 编辑 / 删除 / 重新连接都是用户的明确操作：内存中的记忆一并清除（持久的锁定以 auth_state 为准）
    this.memory.clearFailures(connectionId)
    this.memory.clearModes(connectionId)
    this.memory.sudoLocked.delete(connectionId)
    this.authLocked.delete(connectionId)
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

  async test(connectionId: string): Promise<ConnectionTestResult> {
    const rec = await this.deps.repo.get(connectionId)
    if (!rec) throw new AppError({ code: 'CONN_NOT_FOUND' })
    const steps: ConnectionTestStep[] = []
    const fail = (step: ConnectionTestStep['step'], e: unknown): void => {
      steps.push({ step, ok: false, error: toAppError(e).toPayload() })
    }

    let reached = false
    let hostKeyOk: boolean | null = null
    let ssh: SshSession
    try {
      ssh = await this.dial(rec, {
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
      if (!reached) {
        // 私钥 / 机密的问题发生在连接之前
        const local = err.code === 'CONN_KEY_INVALID' || err.code === 'CONN_SECRET_UNAVAILABLE'
        fail(local ? 'auth' : 'connect', err)
      } else if (hostKeyOk === null) {
        fail('hostKey', err)
      } else if (hostKeyOk) {
        fail('auth', err)
        if (err.code === 'CONN_AUTH_FAILED' && !isNoMethod(err)) await this.lockAuth(connectionId)
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
      const sudoAuthFailed = await testIdentitySteps(rec, ssh, this.identityDeps, steps)
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
    const pending: Promise<unknown>[] = [...this.attempts.values()]
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
    const mine = (async (): Promise<SshSession> => {
      if (prev) await prev.catch(() => undefined)
      return this.attempt(conn)
    })()
    this.attempts.set(id, mine)
    void mine
      .catch(() => undefined)
      .finally(() => {
        if (this.attempts.get(id) === mine) this.attempts.delete(id)
      })
    return mine
  }

  private async attempt(conn: Conn): Promise<SshSession> {
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
   * 拨号时的记录之后没有被编辑（R12：updatedAt 相同）。读取失败时按「未编辑」处理（偏向锁定）；
   * 记录已删除时无需锁定
   */
  private async unchangedSince(dialed: ConnectionRecord): Promise<boolean> {
    const cur = await this.deps.repo.get(dialed.id).catch(() => dialed)
    return cur !== undefined && cur.updatedAt === dialed.updatedAt
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
    this.memory.clearFailures(conn.id)
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
    this.memory.clearFailures(conn.id)
    this.deps.log.info(`connection ${conn.id}: idle disconnect`)
    this.setState(conn.id, 'idle')
  }

  /** 会话包装：记录进行中的请求与时刻（空闲判断），并用于 invalidate 找到归属 */
  private wrap(conn: Conn, identity: string | null, s: SftpSession): SftpSession {
    const run = async <T>(fn: () => Promise<T>): Promise<T> => {
      conn.active++
      this.clearIdle(conn)
      try {
        return await fn()
      } finally {
        conn.active--
        this.touch(conn)
      }
    }
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
    entry.promise = ssh.sftp().then(
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

  // ---- test() 与状态 ----

  private async testSftp(ssh: SshSession, steps: ConnectionTestStep[]): Promise<void> {
    const ctrl = new AbortController()
    const timer = this.deps.setTimer(() => ctrl.abort(), this.deps.settings().timeoutSec * 1000)
    try {
      const sftp = await ssh.sftp()
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
