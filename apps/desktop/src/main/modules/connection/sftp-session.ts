import { AppError } from '@pch/shared'
import type { FileEntry as Ssh2FileEntry, Stats } from 'ssh2'
import type { SftpAttrs, SftpDirEntry, SftpSession } from '../../vfs/providers/sftp.provider'
import { toSftpAppError } from '../../vfs/sftp-errors'

type Cb<T> = (err: Error | undefined, value: T) => void

/** ssh2 的 SFTPWrapper（client.sftp()）与内部 SFTP 类（sftp-bridge）共有的部分 */
export interface RawSftp {
  stat(path: string, cb: Cb<Stats>): void
  lstat(path: string, cb: Cb<Stats>): void
  readdir(path: string, cb: Cb<Ssh2FileEntry[]>): void
  realpath(path: string, cb: Cb<string>): void
  on(event: 'end' | 'close' | 'error', listener: (...args: unknown[]) => void): unknown
}

/**
 * 通道结束时 ssh2 以此消息让未完成的请求失败（lib/protocol/SFTP.js cleanupRequests，第 2723 行；
 * 套接字关闭 → lib/utils.js onCHANNEL_CLOSE → push(null)），没有数字状态码
 */
const NO_RESPONSE = 'No response from server'

const attrsOf = (a: Stats | Ssh2FileEntry['attrs']): SftpAttrs => ({
  mode: a.mode,
  size: a.size,
  mtime: a.mtime
})

/**
 * 把 ssh2 的回调式 SFTP 包成 Promise 的 SftpSession：
 * - signal 中止 → FS_CANCELLED，晚到的结果丢弃；
 * - 通道已结束（end / close / error）→ 新请求立即以 FS_UNAVAILABLE 失败（ssh2 对已关闭的通道静默丢弃请求，会永远挂起）；
 * - 其余错误经 toSftpAppError。
 */
export function wrapSftp(raw: RawSftp): SftpSession {
  let closed = false
  const markClosed = (): void => {
    closed = true
  }
  raw.on('end', markClosed)
  raw.on('close', markClosed)
  // 必须监听 error：ssh2 的协议错误以 'error' 事件发出（doFatalSFTPError），无监听者时进程崩溃
  raw.on('error', markClosed)

  const toError = (e: unknown): AppError => {
    if (closed || (e instanceof Error && e.message === NO_RESPONSE && !('code' in e))) {
      return new AppError({ code: 'FS_UNAVAILABLE', detail: 'sftp channel closed' })
    }
    return toSftpAppError(e)
  }

  function call<R, T>(
    signal: AbortSignal,
    start: (cb: Cb<R>) => void,
    map: (v: R) => T
  ): Promise<T> {
    if (signal.aborted) return Promise.reject(new AppError({ code: 'FS_CANCELLED' }))
    if (closed) return Promise.reject(toError(null))
    return new Promise<T>((resolve, reject) => {
      let done = false
      const onAbort = (): void => {
        if (done) return
        done = true
        reject(new AppError({ code: 'FS_CANCELLED' }))
      }
      signal.addEventListener('abort', onAbort, { once: true })
      const finish = (err: unknown, value?: R): void => {
        if (done) return
        done = true
        signal.removeEventListener('abort', onAbort)
        if (err) reject(toError(err))
        else resolve(map(value as R))
      }
      try {
        start((err, value) => finish(err, value))
      } catch (e) {
        finish(e ?? new Error('sftp call failed'))
      }
    })
  }

  return {
    stat: (path, signal) => call<Stats, SftpAttrs>(signal, (cb) => raw.stat(path, cb), attrsOf),
    lstat: (path, signal) => call<Stats, SftpAttrs>(signal, (cb) => raw.lstat(path, cb), attrsOf),
    readdir: (path, signal) =>
      call<Ssh2FileEntry[], SftpDirEntry[]>(
        signal,
        (cb) => raw.readdir(path, cb),
        (list) =>
          list.map((d) => ({ filename: d.filename, longname: d.longname, attrs: attrsOf(d.attrs) }))
      ),
    realpath: (path, signal) =>
      call<string, string>(
        signal,
        (cb) => raw.realpath(path, cb),
        (p) => p
      )
  }
}
