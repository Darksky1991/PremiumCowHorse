import fs from 'node:fs/promises'
import { AppError } from '@pch/shared'
import { toAppError } from '../../main/vfs/errors'
import { listChildren, throwIfAborted } from '../../main/vfs/fs-list'
import { fileUriToLocalPath } from '../../main/vfs/local-path'
import { hostKey, location, shareKey } from '../../main/vfs/location'
import type { Enumerator, RawEntry } from './types'

/**
 * koffi 不可用时的回退：readdir + lstat（与 LocalProvider.list 共用 fs-list.ts）。
 * 隐藏按「名称以 . 开头」判断；普通 readdir 会更新目录自身的最后访问时间，无法避免。
 */
export class FsEnumerator implements Enumerator {
  readonly native = false

  async statDir(uri: string, signal: AbortSignal): Promise<{ mtime: number }> {
    try {
      throwIfAborted(signal)
      // stat 跟随链接：取链接目标目录的修改时间
      const s = await fs.stat(fileUriToLocalPath(uri))
      if (!s.isDirectory()) throw new AppError({ code: 'FS_NOT_A_DIRECTORY', detail: uri })
      return { mtime: s.mtimeMs }
    } catch (e) {
      throw toAppError(e)
    }
  }

  async list(uri: string, opts: { signal: AbortSignal; onBatch: () => void }): Promise<RawEntry[]> {
    try {
      throwIfAborted(opts.signal)
      const children = await listChildren(fileUriToLocalPath(uri), opts.signal)
      opts.onBatch()
      return children.map((c) => ({ ...c, hidden: c.name.startsWith('.') }))
    } catch (e) {
      throw toAppError(e)
    }
  }

  location = location
  shareKey = shareKey
  hostKey = hostKey
}
