import { randomUUID } from 'node:crypto'
import {
  AppError,
  type ConnectionDto,
  type ConnectionSaveInput,
  type ConnectionTestResult,
  type HostKeyInfo
} from '@pch/shared'
import type { ConnectionPool } from './connection-pool'
import type { ConnectionRecord, ConnectionRepo } from './connection.repo'
import type { SecretBox } from './secret-box'

export interface ConnectionServiceDeps {
  repo: ConnectionRepo
  secrets: SecretBox
  pool: Pick<
    ConnectionPool,
    'state' | 'presentedHostKey' | 'disconnect' | 'unlock' | 'test' | 'home'
  >
  /** 连接列表有变化（保存 / 删除 / 信任密钥 / 重新连接 / 测试之后）→ connection.changed */
  emitChanged(): void
  /** 连接被重置（编辑 / 删除 / 重新连接 / 信任新密钥）：立即重新检查该连接的远程条目根 */
  onConnectionReset(connectionId: string): void
  now(): number
  /** home 的超时（毫秒；组合根取 vfs.timeoutSec.remote）。默认 30 秒 */
  timeoutMs?: () => number
}

const DEFAULT_TIMEOUT_MS = 30_000

const sameList = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((v, i) => v === b[i])

/**
 * 远程连接的管理（设计 devDoc/2026-11-22-37 第 5.2、5.3 节）。
 * 机密只在主进程：DTO 只有 hasSecret / hasSudoSecret；保存时收到的明文立即加密，不进错误信息与日志。
 */
export class ConnectionService {
  constructor(private readonly deps: ConnectionServiceDeps) {}

  async list(): Promise<ConnectionDto[]> {
    return (await this.deps.repo.list()).map((r) => this.toDto(r))
  }

  /**
   * 新建（无 id）或编辑。secret / sudoSecret：省略 = 不变，空串 / null = 清除。
   * 编辑：host / port 变化时清除已信任的主机密钥（D6）。锁定只在对应的凭据有变化时解除（设计 5.3、C1）：
   * - 登录锁定（auth-failed）：提交了 secret，或 host / port / username / auth / keyPath 有变化；
   * - sudo 锁定（sudo-auth-failed）：提交了 sudoSecret，或 sudoSecret 为空且提交了 secret（登录密码兼作 sudo 密码）；
   * - 未锁定时登录凭据有变化也写 ok：覆盖与本次编辑竞争写入的、旧凭据的锁定。
   * 只改名称 / 身份列表 / sftp-server 路径不解除——否则保存一次就以原来的错误密码重连一次。
   * 先写库，再断开连接（连接池按凭据字段判断拨号之后是否被编辑过，旧尝试的失败不再写锁定）；
   * 只改名称时不断开、不重新检查条目根
   */
  async save(input: ConnectionSaveInput): Promise<ConnectionDto> {
    const { repo, pool } = this.deps
    const secret = this.seal(input.secret)
    const sudoSecret = this.seal(input.sudoSecret)
    const now = this.deps.now()
    const fields = {
      name: input.name,
      host: input.host,
      port: input.port,
      username: input.username,
      auth: input.auth,
      keyPath: input.keyPath,
      identities: input.identities,
      sftpServerPath: input.sftpServerPath
    }

    let id: string
    /** 连接需要重置（断开并重新检查条目根）：新建，或编辑了名称以外的字段 */
    let reset = true
    if (input.id === undefined) {
      id = randomUUID()
      await repo.insert({
        id,
        ...fields,
        authState: 'ok',
        secret: secret ?? null,
        sudoSecret: sudoSecret ?? null,
        hostKey: null,
        createdAt: now,
        updatedAt: now
      })
    } else {
      id = input.id
      const existing = await repo.get(id)
      if (!existing) throw new AppError({ code: 'CONN_NOT_FOUND' })
      const moved = existing.host !== input.host || existing.port !== input.port
      const loginChanged =
        secret !== undefined ||
        moved ||
        existing.username !== input.username ||
        existing.auth !== input.auth ||
        existing.keyPath !== input.keyPath
      const nextSudoSecret = sudoSecret === undefined ? existing.sudoSecret : sudoSecret
      const sudoChanged =
        sudoSecret !== undefined || (nextSudoSecret === null && secret !== undefined)
      const unlock = existing.authState === 'sudo-auth-failed' ? sudoChanged : loginChanged
      reset =
        loginChanged ||
        sudoChanged ||
        existing.sftpServerPath !== input.sftpServerPath ||
        !sameList(existing.identities, input.identities)
      await repo.update(id, {
        ...fields,
        ...(secret === undefined ? {} : { secret }),
        ...(sudoSecret === undefined ? {} : { sudoSecret }),
        ...(moved ? { hostKey: null } : {}),
        ...(unlock ? { authState: 'ok' as const } : {}),
        // 同一毫秒内的编辑也必须得到新的 updatedAt
        updatedAt: Math.max(now, existing.updatedAt + 1)
      })
      if (reset) pool.disconnect(id, { keepAuthLock: !loginChanged, keepSudoLock: !sudoChanged })
    }
    const saved = await repo.get(id)
    if (!saved) throw new AppError({ code: 'CONN_NOT_FOUND' })
    if (reset) this.changed(id)
    else this.deps.emitChanged()
    return this.toDto(saved)
  }

  /** 先断开再删除；引用它的条目保留（显示「连接不存在」）。不存在 → CONN_NOT_FOUND */
  async delete(id: string): Promise<void> {
    await this.require(id)
    this.deps.pool.disconnect(id)
    await this.deps.repo.delete(id)
    this.changed(id)
  }

  async test(id: string): Promise<ConnectionTestResult> {
    try {
      return await this.deps.pool.test(id)
    } finally {
      // 测试可能写入锁定状态 / 解除锁定 / 保存主机密钥：通知变化，并立即重新检查该连接的条目根
      this.changed(id)
    }
  }

  /** 「重新连接」：解除锁定（auth_state 与内存）并断开，之后的请求重新连接 */
  async reconnect(id: string): Promise<void> {
    await this.require(id)
    await this.deps.pool.unlock(id)
    this.deps.pool.disconnect(id)
    this.changed(id)
  }

  /**
   * 「信任新的密钥」：保存用户看到的密钥 seen（disconnect 会清除出示的密钥，所以先比较、写库，再断开）。
   * I4：与服务器最新出示的密钥不一致（确认框打开之后服务器又出示了别的密钥）→ CONN_HOST_KEY_CHANGED，
   * 不保存用户没有看到的密钥；渲染端随之刷新列表、显示新的密钥
   */
  async trustHostKey(id: string, seen: HostKeyInfo): Promise<void> {
    const key = this.deps.pool.presentedHostKey(id)
    if (key === null)
      throw new AppError({ code: 'CONN_NOT_FOUND', detail: 'no presented host key' })
    if (key.algorithm !== seen.algorithm || key.fingerprint !== seen.fingerprint) {
      throw new AppError({ code: 'CONN_HOST_KEY_CHANGED', detail: key.fingerprint })
    }
    await this.require(id)
    await this.deps.repo.setHostKey(id, key)
    this.deps.pool.disconnect(id)
    this.changed(id)
  }

  /** 登录用户的主目录（realpath .）；切换身份为 / */
  async home(id: string, identity: string | null): Promise<string> {
    const ms = this.deps.timeoutMs?.() ?? DEFAULT_TIMEOUT_MS
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), ms)
    try {
      return await this.deps.pool.home({ connectionId: id, identity }, ctrl.signal)
    } catch (e) {
      if (ctrl.signal.aborted) throw new AppError({ code: 'FS_TIMEOUT', detail: 'home' })
      throw e
    } finally {
      clearTimeout(timer)
    }
  }

  // ---- 内部 ----

  private async require(id: string): Promise<ConnectionRecord> {
    const rec = await this.deps.repo.get(id)
    if (!rec) throw new AppError({ code: 'CONN_NOT_FOUND' })
    return rec
  }

  private changed(id: string): void {
    this.deps.emitChanged()
    this.deps.onConnectionReset(id)
  }

  /**
   * 明文 → 加密后的值。undefined = 不变；null / 空串 = 清除（null）。
   * 加密不可用 / 失败 → CONN_SECRET_UNAVAILABLE（不以明文保存；错误中不含明文）
   */
  private seal(plain: string | null | undefined): string | null | undefined {
    if (plain === undefined) return undefined
    if (plain === null || plain === '') return null
    const { secrets } = this.deps
    if (!secrets.available()) {
      throw new AppError({ code: 'CONN_SECRET_UNAVAILABLE', detail: 'encryption unavailable' })
    }
    try {
      return secrets.encrypt(plain)
    } catch {
      throw new AppError({ code: 'CONN_SECRET_UNAVAILABLE', detail: 'encrypt failed' })
    }
  }

  private toDto(r: ConnectionRecord): ConnectionDto {
    return {
      id: r.id,
      name: r.name,
      host: r.host,
      port: r.port,
      username: r.username,
      auth: r.auth,
      keyPath: r.keyPath,
      hasSecret: r.secret !== null,
      hasSudoSecret: r.sudoSecret !== null,
      identities: [...r.identities],
      sftpServerPath: r.sftpServerPath,
      hostKey: r.hostKey,
      presentedHostKey: this.deps.pool.presentedHostKey(r.id),
      authState: r.authState,
      state: this.deps.pool.state(r.id),
      createdAt: r.createdAt,
      updatedAt: r.updatedAt
    }
  }
}
