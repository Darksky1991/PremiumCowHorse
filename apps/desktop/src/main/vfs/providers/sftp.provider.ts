import {
  AppError,
  parseSftpUri,
  sftpChildUri,
  type FileEntry,
  type FileKind,
  type FileStat
} from '@pch/shared'
import { toSftpAppError } from '../sftp-errors'
import type { FileSystemProvider } from '../types'

export interface SftpAttrs {
  mode: number
  size: number
  /** 秒 */
  mtime: number
}
export interface SftpDirEntry {
  filename: string
  longname: string
  attrs: SftpAttrs
}
/** 一个「连接 + 身份」的 SFTP 会话（主进程 modules/connection 实现） */
export interface SftpSession {
  stat(path: string, signal: AbortSignal): Promise<SftpAttrs> // 跟随链接
  lstat(path: string, signal: AbortSignal): Promise<SftpAttrs>
  readdir(path: string, signal: AbortSignal): Promise<SftpDirEntry[]>
  realpath(path: string, signal: AbortSignal): Promise<string>
  /**
   * 关闭 SFTP 通道（可选；超时后才就绪的会话由连接池关闭，K4）。登录用户的 SFTP 子系统通道只关这条通道；
   * 经 sftp-bridge 的身份会话关闭的是 sudo 的 exec 通道（连接池目前只对登录路径调用）
   */
  close?(): void
}
export interface SftpTarget {
  connectionId: string
  identity: string | null
}
export interface SftpSessionSource {
  /** userAction：用户操作发起（断线时重连并重试一次）；后台读取为 false */
  session(
    target: SftpTarget,
    opts: { userAction: boolean; signal: AbortSignal }
  ): Promise<SftpSession>
  /** 会话的连接已断：丢弃它（下一次 session() 重连） */
  invalidate(target: SftpTarget, session: SftpSession): void
}
export interface RemoteCallOptions {
  userAction?: boolean
}

const S_IFMT = 0o170000
const S_IFDIR = 0o040000
const S_IFLNK = 0o120000

/** T10：服务器可能省略 size / mtime（SFTP attrs 的各字段可选）；缺失或非有限数时为 0，避免 NaN 让整张列表被拒绝 */
const num = (v: number | undefined): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

function kindOf(mode: number): FileKind {
  const t = mode & S_IFMT
  return t === S_IFDIR ? 'directory' : t === S_IFLNK ? 'symlink' : 'file'
}

/** longname（ls -l 形式）的第 3 列；取不到为 undefined */
export function ownerOfLongname(longname: string): string | undefined {
  return longname.trim().split(/\s+/)[2] || undefined
}

/** 链接目标的 stat 同时进行的上限（I3：大目录的链接逐个往返会超过看门狗） */
export const LINK_STAT_CONCURRENCY = 32

/** 以至多 limit 个并发对 items 逐个执行 fn；任何一个失败即整体失败（其余仍在进行的结果被丢弃） */
async function eachLimited<T>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<void>
): Promise<void> {
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < items.length) await fn(items[next++] as T)
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
}

function unsupported(): AppError {
  return new AppError({ code: 'FS_UNSUPPORTED_SCHEME', detail: 'sftp: read is not supported' })
}

/**
 * SFTP 远程目录（只读：stat / list）。不持有连接，经 SftpSessionSource 取会话。
 * 文件内容读取（read / createReadStream）本期不支持，不发起连接。
 */
export class SftpProvider implements FileSystemProvider {
  readonly scheme = 'sftp' as const

  constructor(private readonly source: SftpSessionSource) {}

  async stat(uri: URL, signal?: AbortSignal, opts?: RemoteCallOptions): Promise<FileStat> {
    try {
      const { target, path } = parse(uri)
      const a = await this.run(target, signal, opts, (s, sig) => s.stat(path, sig))
      const kind = kindOf(a.mode)
      return {
        uri: uri.href,
        name: path === '/' ? '/' : path.slice(path.lastIndexOf('/') + 1),
        kind,
        size: kind === 'file' ? num(a.size) : 0,
        mtime: num(a.mtime) * 1000
      }
    } catch (e) {
      throw toSftpAppError(e)
    }
  }

  async list(uri: URL, signal?: AbortSignal, opts?: RemoteCallOptions): Promise<FileEntry[]> {
    try {
      const { target, path } = parse(uri)
      return await this.run(target, signal, opts, async (s, sig) => {
        const dirs = await s.readdir(path, sig)
        const out: FileEntry[] = []
        const links: { entry: FileEntry; path: string }[] = []
        for (const d of dirs) {
          if (d.filename === '.' || d.filename === '..') continue
          const kind = kindOf(d.attrs.mode)
          const entry: FileEntry = {
            uri: sftpChildUri(uri.href, d.filename),
            name: d.filename,
            kind,
            size: kind === 'file' ? num(d.attrs.size) : 0,
            mtime: num(d.attrs.mtime) * 1000,
            hidden: d.filename.startsWith('.')
          }
          const owner = ownerOfLongname(d.longname)
          if (owner !== undefined) entry.owner = owner
          if (kind === 'symlink') {
            links.push({ entry, path: path === '/' ? `/${d.filename}` : `${path}/${d.filename}` })
          }
          out.push(entry)
        }
        // 链接目标的类型：有界并发（/usr/lib64、/etc/alternatives 等有上千个链接）
        await eachLimited(links, LINK_STAT_CONCURRENCY, async ({ entry, path: p }) => {
          entry.target = await s.stat(p, sig).then(
            (a) => (kindOf(a.mode) === 'directory' ? 'directory' : 'file'),
            (e: unknown) => {
              // 取消与断线要向上传递；其余（目标不存在、无权限）视为失效链接
              const err = toSftpAppError(e)
              if (err.code === 'FS_CANCELLED' || err.code === 'FS_UNAVAILABLE') throw err
              return null
            }
          )
        })
        return out
      })
    } catch (e) {
      throw toSftpAppError(e)
    }
  }

  async read(): Promise<never> {
    throw unsupported()
  }

  async createReadStream(): Promise<never> {
    throw unsupported()
  }

  async dispose(): Promise<void> {
    // 连接由连接池持有与释放
  }

  /** 取会话并执行；会话方法抛 FS_UNAVAILABLE 且 userAction 时 invalidate 后重试一次（只读，无副作用） */
  private async run<T>(
    target: SftpTarget,
    signal: AbortSignal | undefined,
    opts: RemoteCallOptions | undefined,
    fn: (s: SftpSession, sig: AbortSignal) => Promise<T>
  ): Promise<T> {
    const sig = signal ?? new AbortController().signal
    const userAction = opts?.userAction ?? true
    sig.throwIfAborted()
    let session = await this.source.session(target, { userAction, signal: sig })
    try {
      return await fn(session, sig)
    } catch (e) {
      const err = toSftpAppError(e)
      if (err.code !== 'FS_UNAVAILABLE' || !userAction) throw err
      this.source.invalidate(target, session)
      session = await this.source.session(target, { userAction, signal: sig })
      return await fn(session, sig)
    }
  }
}

function parse(uri: URL): { target: SftpTarget; path: string } {
  const loc = parseSftpUri(uri.href)
  if (!loc) throw new AppError({ code: 'FS_INVALID_URI', detail: uri.href })
  return { target: { connectionId: loc.connectionId, identity: loc.identity }, path: loc.path }
}
