// 测试辅助（单元测试与 e2e 共用）：生产代码不得 import 本文件。
// 真实的 ssh2 Server，只监听 127.0.0.1；只实现 OPENDIR / READDIR / CLOSE / STAT / LSTAT / REALPATH，
// 其余请求由 ssh2 自动回 OP_UNSUPPORTED（无监听者时，lib/protocol/SFTP.js SERVER_HANDLERS）。
import { createHash, timingSafeEqual } from 'node:crypto'
import { lstat, readdir, stat } from 'node:fs/promises'
import { createServer, type Socket } from 'node:net'
import { join, posix } from 'node:path'
import { Server, utils, type Attributes, type FileEntry, type SFTPWrapper } from 'ssh2'
import type { HostKeyInfo } from '@pch/shared'
import { generateEd25519KeyPair } from './test-keys'

export interface FakeSftpServer {
  port: number
  hostKey: HostKeyInfo
  /** 收到的认证尝试（方法名），用于断言「只提交一次」 */
  authAttempts: string[]
  /** keyboard-interactive 收到的应答（每轮一个数组），用于断言「不交出密码」 */
  kbdAnswers: string[][]
  /** 停止响应（不关闭 TCP：模拟静默断线） */
  freeze(): void
  /** 关闭所有连接与监听 */
  close(): Promise<void>
}

export type FakeAuthMethod = 'password' | 'keyboard-interactive'

export interface FakeSftpServerOptions {
  root: string // 本地目录，映射为服务器的 /
  users: Record<string, string> // 用户名 → 密码
  home?: string // realpath('.') 的结果，默认 '/'
  owner?: (path: string) => string // longname 的属主列，默认 'pchuser'
  /** 对返回 true 的服务器路径，OPENDIR / STAT 回 PERMISSION_DENIED（模拟无权限的目录） */
  deny?: (path: string) => boolean
  hostKey?: string // PEM；默认每次生成 ed25519
  /** 提供的认证方式（数组 = 同时列出多种），默认 'password' */
  authMethod?: FakeAuthMethod | FakeAuthMethod[]
  /** keyboard-interactive 的提示，默认 [{ prompt: 'Password: ', echo: false }]；第一个提示的应答与密码比较 */
  kbdPrompts?: { prompt: string; echo: boolean }[]
  /** 监听端口，默认 0（随机）；e2e 用同端口同密钥重启 */
  port?: number
  /** 收到密码（password / keyboard-interactive 的应答）之后：hang = 不回应，close = 断开连接 */
  afterPassword?: 'hang' | 'close'
}

const { STATUS_CODE } = utils.sftp
/** 每个 READDIR 应答的项数（OpenSSH sftp-server 为 100） */
const READDIR_BATCH = 100

function sameSecret(a: string, b: string): boolean {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

function statusOf(e: unknown): number {
  const code = (e as { code?: unknown } | null)?.code
  if (code === 'ENOENT' || code === 'ENOTDIR') return STATUS_CODE.NO_SUCH_FILE
  if (code === 'EACCES' || code === 'EPERM') return STATUS_CODE.PERMISSION_DENIED
  return STATUS_CODE.FAILURE
}

function attrsOf(s: {
  mode: number
  size: number
  uid: number
  gid: number
  atimeMs: number
  mtimeMs: number
}): Attributes {
  return {
    mode: s.mode,
    size: s.size,
    uid: s.uid,
    gid: s.gid,
    atime: Math.floor(s.atimeMs / 1000),
    mtime: Math.floor(s.mtimeMs / 1000)
  }
}

function longnameOf(name: string, a: Attributes, owner: string): string {
  const t = a.mode & 0o170000
  const type = t === 0o040000 ? 'd' : t === 0o120000 ? 'l' : '-'
  const perm = 'rwxrwxrwx'
    .split('')
    .map((c, i) => (a.mode & (0o400 >> i) ? c : '-'))
    .join('')
  const date = new Date(a.mtime * 1000).toUTCString().slice(5, 22)
  return `${type}${perm}    1 ${owner} ${owner} ${String(a.size).padStart(8)} ${date} ${name}`
}

export async function startFakeSftpServer(opts: FakeSftpServerOptions): Promise<FakeSftpServer> {
  const home = opts.home ?? '/'
  const ownerOf = opts.owner ?? (() => 'pchuser')
  const methods: FakeAuthMethod[] = [opts.authMethod ?? 'password'].flat()
  const kbdPrompts = opts.kbdPrompts ?? [{ prompt: 'Password: ', echo: false }]
  // 不直接用 utils.generateKeyPairSync：ssh2 约 1/256 生成畸形的 ed25519 密钥（见 test-keys.ts）
  const hostKeyPem = opts.hostKey ?? generateEd25519KeyPair().private
  const parsed = utils.parseKey(hostKeyPem)
  if (parsed instanceof Error) throw parsed
  const pub = (Array.isArray(parsed) ? parsed[0] : parsed).getPublicSSH()
  // 与产品代码的 hostKeyInfo 独立计算（测试用它做对照）
  const hostKey: HostKeyInfo = {
    algorithm: (Array.isArray(parsed) ? parsed[0] : parsed).type,
    fingerprint: 'SHA256:' + createHash('sha256').update(pub).digest('base64').replace(/=+$/, '')
  }

  const authAttempts: string[] = []
  const kbdAnswers: string[][] = []
  const sockets = new Set<Socket>()
  let frozen = false

  /** 服务器路径 → 本地路径（限制在 root 之内） */
  const local = (p: string): { server: string; local: string } => {
    const server = posix.resolve(home, p || '.')
    const segs = server.split('/').filter(Boolean)
    return { server, local: join(opts.root, ...segs) }
  }

  const denied = (path: string): boolean => opts.deny?.(local(path).server) === true

  const serveSftp = (sftp: SFTPWrapper): void => {
    const dirs = new Map<number, { server: string; local: string; names: string[]; pos: number }>()
    let nextHandle = 0
    const reply = (fn: () => void): void => {
      if (!frozen) fn()
    }
    const handleOf = (h: Buffer): number => (h.length === 4 ? h.readUInt32BE(0) : -1)

    sftp
      .on('REALPATH', (reqid, path) => {
        const { server } = local(path)
        reply(() =>
          sftp.name(reqid, [{ filename: server, longname: server, attrs: {} as Attributes }])
        )
      })
      .on('STAT', (reqid, path) => {
        if (denied(path)) return reply(() => sftp.status(reqid, STATUS_CODE.PERMISSION_DENIED))
        stat(local(path).local).then(
          (s) => reply(() => sftp.attrs(reqid, attrsOf(s))),
          (e: unknown) => reply(() => sftp.status(reqid, statusOf(e)))
        )
      })
      .on('LSTAT', (reqid, path) => {
        lstat(local(path).local).then(
          (s) => reply(() => sftp.attrs(reqid, attrsOf(s))),
          (e: unknown) => reply(() => sftp.status(reqid, statusOf(e)))
        )
      })
      .on('OPENDIR', (reqid, path) => {
        if (denied(path)) return reply(() => sftp.status(reqid, STATUS_CODE.PERMISSION_DENIED))
        const p = local(path)
        readdir(p.local).then(
          (names) => {
            const id = nextHandle++
            dirs.set(id, { ...p, names: ['.', '..', ...names], pos: 0 })
            const h = Buffer.alloc(4)
            h.writeUInt32BE(id, 0)
            reply(() => sftp.handle(reqid, h))
          },
          (e: unknown) => reply(() => sftp.status(reqid, statusOf(e)))
        )
      })
      .on('READDIR', (reqid, handle) => {
        const d = dirs.get(handleOf(handle))
        if (!d) return reply(() => sftp.status(reqid, STATUS_CODE.FAILURE))
        if (d.pos >= d.names.length) return reply(() => sftp.status(reqid, STATUS_CODE.EOF))
        const batch = d.names.slice(d.pos, d.pos + READDIR_BATCH)
        d.pos += batch.length
        Promise.all(
          batch.map(async (name): Promise<FileEntry | null> => {
            const target =
              name === '.' ? d.local : name === '..' ? join(d.local, '..') : join(d.local, name)
            const s = await lstat(target).catch(() => null)
            if (!s) return null
            const attrs = attrsOf(s)
            const serverPath = posix.join(d.server, name)
            return { filename: name, longname: longnameOf(name, attrs, ownerOf(serverPath)), attrs }
          })
        ).then((entries) =>
          reply(() =>
            sftp.name(
              reqid,
              entries.filter((x): x is FileEntry => x !== null)
            )
          )
        )
      })
      .on('CLOSE', (reqid, handle) => {
        const ok = dirs.delete(handleOf(handle))
        reply(() => sftp.status(reqid, ok ? STATUS_CODE.OK : STATUS_CODE.FAILURE))
      })
  }

  const ssh = new Server({ hostKeys: [hostKeyPem] }, (client) => {
    client.on('error', () => {})
    client.on('authentication', (ctx) => {
      authAttempts.push(ctx.method)
      const expected = opts.users[ctx.username]
      const stall = (): boolean => {
        if (opts.afterPassword === 'close') client.end()
        return opts.afterPassword !== undefined
      }
      if (ctx.method === 'password' && methods.includes('password')) {
        if (stall()) return
        return expected !== undefined && sameSecret(ctx.password, expected)
          ? ctx.accept()
          : ctx.reject(methods)
      }
      if (ctx.method === 'keyboard-interactive' && methods.includes('keyboard-interactive')) {
        return ctx.prompt(kbdPrompts, (answers) => {
          kbdAnswers.push(answers)
          if (stall()) return
          const a = answers[0]
          if (expected !== undefined && a !== undefined && sameSecret(a, expected)) ctx.accept()
          else ctx.reject(methods)
        })
      }
      ctx.reject(methods)
    })
    client.on('ready', () => {
      client.on('session', (accept) => {
        const session = accept()
        session.on('sftp', (acceptSftp) => serveSftp(acceptSftp()))
      })
    })
  })

  const net = createServer((sock) => {
    sockets.add(sock)
    sock.on('close', () => sockets.delete(sock))
    sock.on('error', () => {})
    // 冻结期间的新连接：不交给 ssh2（不发送版本行，TCP 保持打开）
    if (frozen) sock.pause()
    else ssh.injectSocket(sock)
  })
  await new Promise<void>((resolve, reject) => {
    net.once('error', reject)
    net.listen(opts.port ?? 0, '127.0.0.1', () => {
      net.off('error', reject)
      resolve()
    })
  })
  const port = (net.address() as { port: number }).port

  return {
    port,
    hostKey,
    authAttempts,
    kbdAnswers,
    freeze: () => {
      frozen = true
      // 不再读取：保活请求、SFTP 请求都得不到应答，TCP 保持打开
      for (const s of sockets) s.pause()
    },
    close: async () => {
      for (const s of sockets) s.destroy()
      sockets.clear()
      await new Promise<void>((resolve) => net.close(() => resolve()))
    }
  }
}
