// 切换身份的会话（设计 5.4）：探测、参数准备、打开（requiretty 时改用终端方式），
// 以及一条 SSH 连接上按身份共享的会话管理（ConnIdentities）。连接池与「测试连接」共用。
import { StringDecoder } from 'node:string_decoder'
import { AppError, type ConnectionTestStep } from '@pch/shared'
import type { Logger } from '../../infra/logger'
import type { SftpSession } from '../../vfs/providers/sftp.provider'
import type { ConnectionRecord, ConnectionRepo } from './connection.repo'
import type { SecretBox } from './secret-box'
import { parseProbeOutput, probeCommand, type ProbeResult } from './server-probe'
import type { sftpOverChannel } from './sftp-bridge'
import type { ExecChannel, SshSession } from './ssh-session'
import {
  NeedsTtyError,
  type openIdentityChannel,
  type SwitchMode,
  type SwitchResult
} from './sudo-switch'

/** 轮询进程表的间隔与身份切换的超时（全局约束） */
export const POLL_INTERVAL_MS = 150
export const SWITCH_TIMEOUT_MS = 15_000
/** 探测命令的等待上限 */
export const PROBE_TIMEOUT_MS = 15_000
/** 探测输出的上限（正常只有几行；登录脚本的杂音不无限累积） */
const PROBE_OUTPUT_MAX = 64 * 1024

/** 打开身份通道失败时按 (connectionId, identity) 记住的错误（R10）：后台请求不再执行命令 */
const REMEMBERED_FAILURES = new Set<string>([
  'CONN_SUDO_FAILED',
  'CONN_SUDO_DENIED',
  'CONN_PROCESS_LIST_HIDDEN',
  'CONN_SFTP_SERVER_NOT_FOUND'
])

/**
 * R16：记住的身份失败在此时长内不因用户操作而重试（直接以记住的错误失败，不执行任何命令）。
 * 启动时恢复的 N 个标签、断开恢复后的 N 个关注点等成批到达的用户操作请求，只在冷却后重试一次，
 * 不会在客户的 sudo 审计日志里各留一条记录
 */
export const IDENTITY_RETRY_COOLDOWN_MS = 30_000

export interface OpenedIdentity {
  sftp: SftpSession
  channel: ExecChannel
  mode: SwitchMode
}

export interface IdentityParams {
  sftpServerPath: string
  password: string | null
}

export function toAppError(e: unknown): AppError {
  return e instanceof AppError
    ? e
    : new AppError({ code: 'UNKNOWN', detail: e instanceof Error ? e.message : String(e) })
}

export const cancelled = (): AppError => new AppError({ code: 'FS_CANCELLED' })

/** 让一个请求等待共享的 Promise；signal 中止时该请求以 FS_CANCELLED 离开，Promise 本身不受影响 */
export function raceSignal<T>(p: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(cancelled())
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(cancelled())
    signal.addEventListener('abort', onAbort, { once: true })
    p.then(
      (v) => {
        signal.removeEventListener('abort', onAbort)
        resolve(v)
      },
      (e: unknown) => {
        signal.removeEventListener('abort', onAbort)
        reject(e)
      }
    )
  })
}

const idKey = (connectionId: string, identity: string): string => `${connectionId}\0${identity}`

/** 解密保存的机密；失败 → CONN_SECRET_UNAVAILABLE（不连接、不锁定） */
export function decryptSecret(secrets: SecretBox, stored: string): string {
  try {
    return secrets.decrypt(stored)
  } catch {
    throw new AppError({ code: 'CONN_SECRET_UNAVAILABLE', detail: 'decrypt failed' })
  }
}

/**
 * 以登录用户执行一次探测（不经 sudo，不留 sudo 日志）。
 * 通道打不开 / 超时 / 输出不完整（没有 PS: 行）→ CONN_SUDO_FAILED（SSH 连接已断时为 FS_UNAVAILABLE）。
 */
export async function runProbe(
  ssh: SshSession,
  timeoutMs = PROBE_TIMEOUT_MS
): Promise<ProbeResult> {
  let ch: ExecChannel
  try {
    ch = await ssh.exec(probeCommand(), { pty: false })
  } catch (e) {
    const err = toAppError(e)
    if (err.code === 'FS_UNAVAILABLE') throw err
    throw new AppError({ code: 'CONN_SUDO_FAILED', detail: `probe: ${err.detail ?? err.code}` })
  }
  return new Promise<ProbeResult>((resolve, reject) => {
    const decoder = new StringDecoder('utf8')
    let out = ''
    const timer = setTimeout(() => {
      ch.close()
      reject(new AppError({ code: 'CONN_SUDO_FAILED', detail: 'probe timeout' }))
    }, timeoutMs)
    timer.unref?.()
    ch.stream.on('data', (d: Buffer) => {
      if (out.length < PROBE_OUTPUT_MAX) out += decoder.write(d)
    })
    // stdout 与 stderr 共用通道窗口：stderr 也要读走
    ch.stderr.on('data', () => undefined)
    ch.onClose(() => {
      clearTimeout(timer)
      const result = parseProbeOutput(out + decoder.end())
      // 没有 PS: 行：通道提前关闭或输出被截断，不能据此判断（调用方不缓存失败的探测）
      if (result.complete) resolve(result)
      else reject(new AppError({ code: 'CONN_SUDO_FAILED', detail: 'probe incomplete' }))
    })
  })
}

/**
 * 打开身份通道之前的检查与参数（设计 5.4 / D4）：
 * 看不到进程表 → CONN_PROCESS_LIST_HIDDEN（不执行 sudo）；sftp-server 未找到且连接未指定 → CONN_SFTP_SERVER_NOT_FOUND。
 * sudo 密码 = 另设的 sudo 密码，否则密码登录的登录密码；私钥登录且未设时为 null。
 */
export function identityParams(
  rec: ConnectionRecord,
  probe: ProbeResult,
  secrets: SecretBox
): IdentityParams {
  if (!probe.processListVisible) {
    throw new AppError({ code: 'CONN_PROCESS_LIST_HIDDEN' })
  }
  const sftpServerPath = rec.sftpServerPath ?? probe.sftpServerPath
  if (sftpServerPath === null) throw new AppError({ code: 'CONN_SFTP_SERVER_NOT_FOUND' })
  const stored = rec.sudoSecret ?? (rec.auth === 'password' ? rec.secret : null)
  const password = stored === null ? null : decryptSecret(secrets, stored)
  return { sftpServerPath, password }
}

export interface OpenIdentityArgs extends IdentityParams {
  ssh: SshSession
  openIdentity: typeof openIdentityChannel
  bridge: typeof sftpOverChannel
  identity: string
  mode: SwitchMode
  signal: AbortSignal
  /** 非终端方式遇到 requiretty：调用方记住该「连接 + 身份」改用终端方式 */
  onNeedsTty(): void
}

/** 打开身份通道并在其上建立 SFTP；requiretty → 以终端方式重试一次（requiretty 在提示之前报告，不涉及密码） */
export async function openIdentitySession(args: OpenIdentityArgs): Promise<OpenedIdentity> {
  const { ssh, identity, sftpServerPath, password, signal } = args
  const run = (mode: SwitchMode): Promise<SwitchResult> =>
    args.openIdentity({
      exec: (command, o) => ssh.exec(command, o),
      identity,
      sftpServerPath,
      password,
      mode,
      pollIntervalMs: POLL_INTERVAL_MS,
      timeoutMs: SWITCH_TIMEOUT_MS,
      signal
    })
  let result: SwitchResult
  try {
    try {
      result = await run(args.mode)
    } catch (e) {
      if (!(e instanceof NeedsTtyError) || args.mode !== 'nopty') throw e
      args.onNeedsTty()
      result = await run('pty')
    }
  } catch (e) {
    if (e instanceof NeedsTtyError) {
      throw new AppError({ code: 'CONN_SUDO_FAILED', detail: 'sudo requires a tty' })
    }
    throw toAppError(e)
  }
  let sftp: SftpSession
  try {
    sftp = await args.bridge(ssh, result.channel, result.firstData)
  } catch (e) {
    result.channel.close()
    throw toAppError(e)
  }
  if (signal.aborted) {
    result.channel.close()
    throw cancelled()
  }
  return { sftp, channel: result.channel, mode: result.mode }
}

/** 按 (connectionId, identity) 的内存记忆（连接池持有一个，跨 SSH 连接存续） */
export class IdentityMemory {
  /** sudo 认证锁定（与 auth_state 同时写；写库失败或竞争中的请求也看得到） */
  readonly sudoLocked = new Set<string>()
  /** at：失败的时刻（R16 的冷却从它算起） */
  private readonly failures = new Map<string, { error: AppError; at: number }>()
  /** requiretty 的「连接 + 身份」改用终端方式 */
  private readonly modes = new Map<string, SwitchMode>()

  /** now：连接池注入的时钟 */
  constructor(private readonly now: () => number) {}

  /**
   * R10：有记住的失败时，后台请求以同一错误失败；用户操作清除记忆后重试。
   * R16：失败后 IDENTITY_RETRY_COOLDOWN_MS 之内的用户操作也以同一错误失败（时钟回拨、差为负时不算在冷却中）
   */
  checkFailure(connectionId: string, identity: string, userAction: boolean): void {
    const key = idKey(connectionId, identity)
    const failure = this.failures.get(key)
    if (!failure) return
    const age = this.now() - failure.at
    const cooling = age >= 0 && age < IDENTITY_RETRY_COOLDOWN_MS
    if (!userAction || cooling) throw new AppError(failure.error.toPayload())
    this.failures.delete(key)
  }

  remember(connectionId: string, identity: string, err: AppError): void {
    if (REMEMBERED_FAILURES.has(err.code)) {
      this.failures.set(idKey(connectionId, identity), { error: err, at: this.now() })
    }
  }

  forget(connectionId: string, identity: string): void {
    this.failures.delete(idKey(connectionId, identity))
  }

  /** SSH 连接断开 / 空闲断开 / disconnect / unlock 时清除该连接的失败记忆 */
  clearFailures(connectionId: string): void {
    this.dropKeys(this.failures, connectionId)
  }

  clearModes(connectionId: string): void {
    this.dropKeys(this.modes, connectionId)
  }

  mode(connectionId: string, identity: string): SwitchMode {
    return this.modes.get(idKey(connectionId, identity)) ?? 'nopty'
  }

  needsTty(connectionId: string, identity: string): void {
    this.modes.set(idKey(connectionId, identity), 'pty')
  }

  private dropKeys(map: Map<string, unknown>, connectionId: string): void {
    const prefix = `${connectionId}\0`
    for (const k of [...map.keys()]) if (k.startsWith(prefix)) map.delete(k)
  }
}

export interface IdentityDeps {
  repo: Pick<ConnectionRepo, 'get'>
  secrets: SecretBox
  openIdentity: typeof openIdentityChannel
  bridge: typeof sftpOverChannel
  log: Logger
  memory: IdentityMemory
  /** sudo 认证失败：按连接锁住全部身份（内存 + auth_state） */
  lockSudo(connectionId: string): Promise<void>
}

interface Entry {
  promise: Promise<SftpSession>
  /** 只在 SSH 连接被丢弃时中止（R11：请求取消不中止打开过程） */
  ctrl: AbortController
  opened: OpenedIdentity | null
  wrapper: SftpSession | null
}

/** 连接已被丢弃时，打开过程的「取消」对等待者而言是连接不可用 */
const unavailable = (): AppError =>
  new AppError({ code: 'FS_UNAVAILABLE', detail: 'ssh connection closed' })

/**
 * 一条 SSH 连接上的切换身份会话：每个身份一个通道，打开过程由并发请求共享。探测每条连接执行一次。
 * 请求被取消只让该请求离开；打开过程（有 15 秒上限）跑完——中途中止会在交出密码后丢掉结果，
 * 下一次请求以同一密码重交（R11）。成功的会话留在池中，无人使用时随空闲断开关闭。
 */
export class ConnIdentities {
  private readonly entries = new Map<string, Entry>()
  private probe: Promise<ProbeResult> | null = null
  private turn: Promise<void> = Promise.resolve()
  private closed = false

  constructor(
    private readonly connectionId: string,
    private readonly ssh: SshSession,
    private readonly deps: IdentityDeps,
    /** 包装会话（连接池记录进行中的请求与归属） */
    private readonly wrap: (identity: string, s: SftpSession) => SftpSession
  ) {}

  async session(identity: string, signal: AbortSignal): Promise<SftpSession> {
    if (this.closed) throw unavailable()
    const entry = this.entries.get(identity) ?? this.start(identity)
    if (entry.wrapper) return entry.wrapper
    return raceSignal(entry.promise, signal)
  }

  /** 会话的通道已断：丢弃并关闭（下一次请求重开） */
  invalidate(identity: string, wrapper: SftpSession): boolean {
    const entry = this.entries.get(identity)
    if (entry?.wrapper !== wrapper) return false
    this.entries.delete(identity)
    entry.opened?.channel.close()
    return true
  }

  /**
   * SSH 连接被丢弃：中止打开中的过程，关闭全部身份通道。等待者得到 FS_UNAVAILABLE；
   * 已交出 sudo 密码而未判定成功的，sudo-switch 以 CONN_SUDO_AUTH_FAILED 结束（锁定）。
   * 返回的 Promise 在被中止的打开过程全部结束（含其锁定写入）后完成（连接池 dispose 等待它）
   */
  close(): Promise<void> {
    this.closed = true
    const opening: Promise<SftpSession>[] = []
    for (const entry of this.entries.values()) {
      if (!entry.wrapper) opening.push(entry.promise)
      entry.ctrl.abort()
      entry.opened?.channel.close()
    }
    this.entries.clear()
    this.probe = null
    return Promise.allSettled(opening).then(() => undefined)
  }

  private start(identity: string): Entry {
    const ctrl = new AbortController()
    const entry: Entry = {
      promise: Promise.resolve(null as unknown as SftpSession),
      ctrl,
      opened: null,
      wrapper: null
    }
    entry.promise = this.open(identity, ctrl.signal).then(
      (opened) => {
        if (this.closed || this.entries.get(identity) !== entry) {
          opened.channel.close()
          throw unavailable()
        }
        entry.opened = opened
        entry.wrapper = this.wrap(identity, opened.sftp)
        // 通道意外结束（sftp-server 退出）：下一次请求重开
        opened.channel.onClose(() => {
          if (this.entries.get(identity) === entry) this.entries.delete(identity)
        })
        return entry.wrapper
      },
      (e: unknown) => {
        if (this.entries.get(identity) === entry) this.entries.delete(identity)
        throw toAppError(e)
      }
    )
    entry.promise.catch(() => undefined)
    this.entries.set(identity, entry)
    return entry
  }

  /**
   * 同一连接上的身份切换逐个进行：sudo 密码错误时只提交一次——并发打开 app1 / root 会让一个错密码
   * 同时提交多次（pam_faillock 按登录用户计数），排在后面的在锁定检查处停下
   */
  private async open(identity: string, signal: AbortSignal): Promise<OpenedIdentity> {
    const prev = this.turn
    let release!: () => void
    const mine = new Promise<void>((r) => (release = r))
    // 下一个要等前一个与本次都结束（本次在排队中被中止时，前一个可能仍在进行）
    this.turn = prev.then(() => mine)
    try {
      await raceSignal(prev, signal)
      return await this.openNow(identity, signal)
    } catch (e) {
      const err = toAppError(e)
      throw err.code === 'FS_CANCELLED' && this.closed ? unavailable() : err
    } finally {
      release()
    }
  }

  private async openNow(identity: string, signal: AbortSignal): Promise<OpenedIdentity> {
    const { deps, connectionId: id } = this
    const { memory } = deps
    let locked = false
    try {
      // 重新读取：sudo 锁定与 sudo 密码以最新为准
      const rec = await deps.repo.get(id)
      if (!rec) throw new AppError({ code: 'CONN_NOT_FOUND' })
      if (rec.authState === 'sudo-auth-failed' || memory.sudoLocked.has(id)) {
        locked = true
        throw new AppError({ code: 'CONN_SUDO_AUTH_FAILED', detail: 'locked' })
      }
      const probe = await raceSignal(this.probeOnce(), signal)
      return await openIdentitySession({
        ssh: this.ssh,
        openIdentity: deps.openIdentity,
        bridge: deps.bridge,
        identity,
        ...identityParams(rec, probe, deps.secrets),
        mode: memory.mode(id, identity),
        signal,
        onNeedsTty: () => memory.needsTty(id, identity)
      })
    } catch (e) {
      const err = toAppError(e)
      if (locked) throw err
      deps.log.warn(`connection ${id}: identity open failed (${err.code})`)
      // 按连接锁住全部身份（pam_faillock 按登录用户计数）；登录用户自己的 SFTP 不受影响。
      // 连接已被丢弃时也要锁：交出密码后断线同样无法排除密码错误
      if (err.code === 'CONN_SUDO_AUTH_FAILED') await deps.lockSudo(id)
      else if (!this.closed) memory.remember(id, identity, err)
      throw err
    }
  }

  private probeOnce(): Promise<ProbeResult> {
    if (this.probe) return this.probe
    const p = runProbe(this.ssh)
    this.probe = p
    p.catch(() => {
      if (this.probe === p) this.probe = null
    })
    return p
  }
}

/**
 * 「测试连接」的身份步骤：逐个身份打开后立即关闭；第一次 sudo 认证失败即停止（锁定）并返回 true。
 * 成功的身份清除 R10 记忆。
 */
export async function testIdentitySteps(
  rec: ConnectionRecord,
  ssh: SshSession,
  deps: IdentityDeps,
  steps: ConnectionTestStep[]
): Promise<boolean> {
  const { memory } = deps
  let probe: Promise<ProbeResult> | null = null
  for (const identity of rec.identities) {
    try {
      probe ??= runProbe(ssh)
      const params = identityParams(rec, await probe, deps.secrets)
      const opened = await openIdentitySession({
        ssh,
        openIdentity: deps.openIdentity,
        bridge: deps.bridge,
        identity,
        ...params,
        mode: memory.mode(rec.id, identity),
        signal: new AbortController().signal,
        onNeedsTty: () => memory.needsTty(rec.id, identity)
      })
      opened.channel.close()
      memory.forget(rec.id, identity)
      steps.push({
        step: 'identity',
        identity,
        ok: true,
        info: { sftpServerPath: params.sftpServerPath, mode: opened.mode }
      })
    } catch (e) {
      const err = toAppError(e)
      steps.push({ step: 'identity', identity, ok: false, error: err.toPayload() })
      if (err.code === 'CONN_SUDO_AUTH_FAILED') {
        await deps.lockSudo(rec.id)
        return true
      }
    }
  }
  return false
}
