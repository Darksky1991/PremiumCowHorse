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

function kindOf(mode: number): FileKind {
  const t = mode & S_IFMT
  return t === S_IFDIR ? 'directory' : t === S_IFLNK ? 'symlink' : 'file'
}

/** longname（ls -l 形式）的第 3 列；取不到为 undefined */
export function ownerOfLongname(longname: string): string | undefined {
  return longname.trim().split(/\s+/)[2] || undefined
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
        size: kind === 'file' ? a.size : 0,
        mtime: a.mtime * 1000
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
        for (const d of dirs) {
          if (d.filename === '.' || d.filename === '..') continue
          const kind = kindOf(d.attrs.mode)
          const entry: FileEntry = {
            uri: sftpChildUri(uri.href, d.filename),
            name: d.filename,
            kind,
            size: kind === 'file' ? d.attrs.size : 0,
            mtime: d.attrs.mtime * 1000,
            hidden: d.filename.startsWith('.')
          }
          const owner = ownerOfLongname(d.longname)
          if (owner !== undefined) entry.owner = owner
          if (kind === 'symlink') {
            const childPath = path === '/' ? `/${d.filename}` : `${path}/${d.filename}`
            entry.target = await s.stat(childPath, sig).then(
              (a) => (kindOf(a.mode) === 'directory' ? 'directory' : 'file'),
              (e: unknown) => {
                // 取消与断线要向上传递；其余（目标不存在、无权限）视为失效链接
                const err = toSftpAppError(e)
                if (err.code === 'FS_CANCELLED' || err.code === 'FS_UNAVAILABLE') throw err
                return null
              }
            )
          }
          out.push(entry)
        }
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
