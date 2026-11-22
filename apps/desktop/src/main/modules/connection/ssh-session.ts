import { createHash } from 'node:crypto'
import type { Duplex, Readable } from 'node:stream'
import {
  Client,
  utils,
  type AnyAuthMethod,
  type AuthenticationType,
  type ClientChannel,
  type ConnectConfig,
  type ParsedKey,
  type Prompt
} from 'ssh2'
import { AppError, type HostKeyInfo } from '@pch/shared'
import type { SftpSession } from '../../vfs/providers/sftp.provider'
import { wrapSftp } from './sftp-session'

export type SshAuth =
  { kind: 'password'; password: string } | { kind: 'key'; privateKey: Buffer; passphrase?: string }

export interface SshConnectConfig {
  host: string
  port: number
  username: string
  auth: SshAuth
  keepaliveSec: number
  readyTimeoutMs: number
  /** 服务器出示的主机密钥；返回 false 拒绝（调用方决定 CONN_HOST_KEY_REJECTED / CHANGED） */
  verifyHostKey(key: HostKeyInfo): Promise<boolean>
}

export interface ExecChannel {
  readonly stream: Duplex // stdout / stdin
  readonly stderr: Readable
  write(data: string | Uint8Array): void
  close(): void
  onClose(cb: () => void): void
}

export interface SshSession {
  sftp(): Promise<SftpSession> // SFTP 子系统
  exec(command: string, opts: { pty: boolean }): Promise<ExecChannel>
  /** 认证用的原始 ssh2 Client（只给 sftp-bridge 用） */
  readonly client: Client
  onClose(cb: (error: AppError | null) => void): void
  close(): void
}

/** 原始公钥 blob（SSH wire 格式：string 算法名 + 算法相关数据）→ { algorithm, fingerprint: 'SHA256:<base64 无填充>' } */
export function hostKeyInfo(blob: Buffer): HostKeyInfo {
  const len = blob.length >= 4 ? blob.readUInt32BE(0) : 0
  const algorithm = len > 0 && 4 + len <= blob.length ? blob.toString('latin1', 4, 4 + len) : ''
  const fingerprint =
    'SHA256:' + createHash('sha256').update(blob).digest('base64').replace(/=+$/, '')
  return { algorithm, fingerprint }
}

/** ssh2 的 parseKey 在缺少口令时返回的错误消息都以此结尾（lib/protocol/keyParser.js 第 496、848、1047 行） */
const NEEDS_PASSPHRASE = /but no passphrase given$/

function keyInvalid(detail: string): AppError {
  return new AppError({ code: 'CONN_KEY_INVALID', detail })
}

/**
 * 解析私钥（连接之前；失败不连接服务器）：先不带口令解析，只有结果表明需要口令（加密的密钥）时才带口令再解析。
 * 未加密的 .ppk 带口令解析会因 MAC 校验失败（台账 T1-a），所以不能一开始就传口令。
 */
export function parsePrivateKey(privateKey: Buffer, passphrase: string | undefined): ParsedKey {
  let parsed = utils.parseKey(privateKey)
  if (parsed instanceof Error && NEEDS_PASSPHRASE.test(parsed.message)) {
    if (!passphrase) throw keyInvalid('passphrase required')
    parsed = utils.parseKey(privateKey, passphrase)
  }
  if (parsed instanceof Error) throw keyInvalid(parsed.message)
  // OpenSSH 新格式可能返回数组（README「parseKey」）；目前只存 1 个密钥
  const key = Array.isArray(parsed) ? (parsed[0] as ParsedKey | undefined) : parsed
  if (!key || !key.isPrivateKey()) throw keyInvalid('not a private key')
  return key
}

/** ssh2 Client 的 error 事件带 level（README Client events；lib/client.js 第 717、804、864、1115 行） */
type Ssh2Error = Error & { level?: string }

/** 连接建立之前的错误 → AppError（台账 T1-b：握手超时与保活超时 level 同为 client-timeout，按消息区分） */
function connectError(err: Ssh2Error): AppError {
  const detail = [err.level, err.message].filter(Boolean).join(': ')
  switch (err.level) {
    case 'client-authentication':
      return new AppError({ code: 'CONN_AUTH_FAILED', detail })
    case 'client-timeout':
      return new AppError({
        code: /handshake/i.test(err.message) ? 'FS_TIMEOUT' : 'FS_UNAVAILABLE',
        detail
      })
    case 'client-socket':
    case 'client-dns':
      return new AppError({ code: 'FS_UNAVAILABLE', detail })
    default:
      return new AppError({ code: 'UNKNOWN', detail })
  }
}

function unavailable(detail: string): AppError {
  return new AppError({ code: 'FS_UNAVAILABLE', detail })
}

/** ssh2 的命令通道 → ExecChannel */
export function toExecChannel(ch: ClientChannel): ExecChannel {
  let closed = false
  const waiters: (() => void)[] = []
  ch.on('close', () => {
    if (closed) return
    closed = true
    for (const cb of waiters.splice(0)) cb()
  })
  // 无监听者的 error 事件会让进程崩溃；通道错误随后以 close 体现
  ch.on('error', () => {})
  return {
    stream: ch,
    stderr: ch.stderr,
    write: (data) => {
      if (!closed) ch.write(data)
    },
    close: () => {
      if (!closed) ch.close()
    },
    onClose: (cb) => {
      if (closed) queueMicrotask(cb)
      else waiters.push(cb)
    }
  }
}

/**
 * 认证方式的选择（设计 5.2「一次连接只用一种方式提交一次密码」）：
 * 第一次以 none 询问服务器接受的方式（不提交任何凭据），然后只选一种：
 * 密码 → 有 password 用它，否则 keyboard-interactive（以密码作答一轮提示）；私钥 → publickey。
 * 选过一次后返回 false 结束（ssh2 以 client-authentication 报错，lib/client.js 第 863–866 行）。
 */
function makeAuthHandler(
  username: string,
  auth: SshAuth,
  key: ParsedKey | null,
  onExtraPrompt: () => void
) {
  let step = 0
  return (methodsLeft: AuthenticationType[] | null): AnyAuthMethod | false => {
    step++
    if (step === 1) return { type: 'none', username }
    if (step > 2 || !methodsLeft) return false
    if (auth.kind === 'key') {
      return key && methodsLeft.includes('publickey') ? { type: 'publickey', username, key } : false
    }
    if (methodsLeft.includes('password')) {
      return { type: 'password', username, password: auth.password }
    }
    if (methodsLeft.includes('keyboard-interactive')) {
      let answered = false
      return {
        type: 'keyboard-interactive',
        username,
        prompt: (_name, _instructions, _lang, prompts: Prompt[], finish) => {
          // 没有问题的一轮（OpenSSH PAM 常见）照常应答；第二轮带问题的提示不再交出密码
          if (prompts.length === 0) return finish([])
          if (answered) return onExtraPrompt()
          answered = true
          finish(prompts.map(() => auth.password))
        }
      }
    }
    return false
  }
}

export function connectSsh(cfg: SshConnectConfig): Promise<SshSession> {
  let key: ParsedKey | null = null
  try {
    if (cfg.auth.kind === 'key') key = parsePrivateKey(cfg.auth.privateKey, cfg.auth.passphrase)
  } catch (e) {
    return Promise.reject(e)
  }

  const client = new Client()
  return new Promise<SshSession>((resolve, reject) => {
    let settled = false
    /** 由我们决定的失败原因（主机密钥被拒、多余的认证提示），优先于 ssh2 的错误 */
    let failure: AppError | null = null

    const fail = (e: AppError): void => {
      if (settled) return
      settled = true
      reject(e)
      client.end()
      client.destroy()
    }

    const hostVerifier = (blob: Buffer, verify: (ok: boolean) => void): void => {
      let info: HostKeyInfo
      try {
        info = hostKeyInfo(blob)
      } catch {
        info = { algorithm: '', fingerprint: '' }
      }
      cfg.verifyHostKey(info).then(
        (ok) => {
          if (!ok)
            failure = new AppError({ code: 'CONN_HOST_KEY_REJECTED', detail: info.fingerprint })
          verify(ok)
        },
        (e: unknown) => {
          failure =
            e instanceof AppError
              ? e
              : new AppError({
                  code: 'CONN_HOST_KEY_REJECTED',
                  detail: e instanceof Error ? e.message : String(e)
                })
          verify(false)
        }
      )
    }

    const authHandler = makeAuthHandler(cfg.username, cfg.auth, key, () => {
      failure = new AppError({
        code: 'CONN_AUTH_FAILED',
        detail: 'additional keyboard-interactive prompts are not answered'
      })
      client.end()
    })

    client.on('error', (err: Ssh2Error) => {
      if (!settled) fail(failure ?? connectError(err))
    })
    client.on('close', () => {
      if (!settled) fail(failure ?? unavailable('connection closed before ready'))
    })
    client.once('ready', () => {
      if (settled) return
      settled = true
      resolve(createSession(client))
    })

    const config: ConnectConfig = {
      host: cfg.host,
      port: cfg.port,
      username: cfg.username,
      // T1-c：固定 (key, verify) 两参数形式；不设 hostHash，key 为原始公钥 blob
      hostVerifier: hostVerifier as ConnectConfig['hostVerifier'],
      authHandler: authHandler as unknown as ConnectConfig['authHandler'],
      keepaliveInterval: cfg.keepaliveSec * 1000,
      keepaliveCountMax: 3,
      readyTimeout: cfg.readyTimeoutMs
    }
    try {
      client.connect(config)
    } catch (e) {
      fail(new AppError({ code: 'UNKNOWN', detail: e instanceof Error ? e.message : String(e) }))
    }
  })
}

/** 已认证的 Client → SshSession */
function createSession(client: Client): SshSession {
  let closed = false
  let closedByUs = false
  let lastError: Ssh2Error | null = null
  let result: AppError | null = null
  const listeners: ((error: AppError | null) => void)[] = []

  client.on('error', (err: Ssh2Error) => {
    lastError = err
  })
  client.on('close', () => {
    if (closed) return
    closed = true
    // 自己关闭 → null；保活超时 / 套接字错误 / 服务器断开 → FS_UNAVAILABLE（台账 T1-b）
    result = closedByUs
      ? null
      : unavailable(
          lastError
            ? [lastError.level, lastError.message].filter(Boolean).join(': ')
            : 'connection closed'
        )
    for (const cb of listeners.splice(0)) cb(result)
  })

  const ensureOpen = (): void => {
    if (closed || closedByUs) throw unavailable('ssh session closed')
  }
  // 套接字已不可写但 close 事件尚未到达时，ssh2 同步抛出 'Not connected'（lib/client.js 第 1193、1556 行）
  const openError = (e: unknown): AppError =>
    closed || closedByUs || (e instanceof Error && e.message === 'Not connected')
      ? unavailable('ssh session closed')
      : e instanceof AppError
        ? e
        : new AppError({ code: 'UNKNOWN', detail: e instanceof Error ? e.message : String(e) })

  return {
    client,
    sftp: () =>
      new Promise<SftpSession>((resolve, reject) => {
        try {
          ensureOpen()
          client.sftp((err, raw) => (err ? reject(openError(err)) : resolve(wrapSftp(raw))))
        } catch (e) {
          reject(openError(e))
        }
      }),
    exec: (command, opts) =>
      new Promise<ExecChannel>((resolve, reject) => {
        try {
          ensureOpen()
          // 终端方式：与先行试验相同的 dumb 终端（设计 5.4）
          const execOpts = opts.pty ? { pty: { term: 'dumb', modes: {} } } : {}
          client.exec(command, execOpts, (err, ch) =>
            err ? reject(openError(err)) : resolve(toExecChannel(ch))
          )
        } catch (e) {
          reject(openError(e))
        }
      }),
    onClose: (cb) => {
      if (closed) queueMicrotask(() => cb(result))
      else listeners.push(cb)
    },
    close: () => {
      if (closed || closedByUs) return
      closedByUs = true
      client.end()
    }
  }
}
