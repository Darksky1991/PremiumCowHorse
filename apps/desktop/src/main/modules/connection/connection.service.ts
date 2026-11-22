import { randomUUID } from 'node:crypto'
import {
  AppError,
  type ConnectionDto,
  type ConnectionSaveInput,
  type ConnectionTestResult
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
   * 编辑：host / port 变化时清除已信任的主机密钥（D6）；解除认证锁定（authState = ok）并更新 updatedAt
   * （连接池据此判断拨号之后记录被编辑过，旧尝试的失败不再写锁定）——先写库，再断开连接
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
      sftpServerPath: input.sftpServerPath,
      authState: 'ok' as const
    }

    let id: string
    if (input.id === undefined) {
      id = randomUUID()
      await repo.insert({
        id,
        ...fields,
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
      await repo.update(id, {
        ...fields,
        ...(secret === undefined ? {} : { secret }),
        ...(sudoSecret === undefined ? {} : { sudoSecret }),
        ...(moved ? { hostKey: null } : {}),
        // 同一毫秒内的编辑也必须得到新的 updatedAt
        updatedAt: Math.max(now, existing.updatedAt + 1)
      })
      pool.disconnect(id)
    }
    const saved = await repo.get(id)
    if (!saved) throw new AppError({ code: 'CONN_NOT_FOUND' })
    this.changed(id)
    return this.toDto(saved)
  }

  /** 先断开再删除；引用它的条目保留（显示「连接不存在」） */
  async delete(id: string): Promise<void> {
    this.deps.pool.disconnect(id)
    await this.deps.repo.delete(id)
    this.changed(id)
  }

  async test(id: string): Promise<ConnectionTestResult> {
    try {
      return await this.deps.pool.test(id)
    } finally {
      // 测试可能写入锁定状态 / 解除锁定 / 保存主机密钥
      this.deps.emitChanged()
    }
  }

  /** 「重新连接」：解除锁定（auth_state 与内存）并断开，之后的请求重新连接 */
  async reconnect(id: string): Promise<void> {
    await this.require(id)
    await this.deps.pool.unlock(id)
    this.deps.pool.disconnect(id)
    this.changed(id)
  }

  /** 「信任新的密钥」：保存服务器出示的新密钥（disconnect 会清除它，所以先读出、写库，再断开） */
  async trustHostKey(id: string): Promise<void> {
    const key = this.deps.pool.presentedHostKey(id)
    if (key === null)
      throw new AppError({ code: 'CONN_NOT_FOUND', detail: 'no presented host key' })
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
