import fs from 'node:fs/promises'
import type { Stats } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type { FileEntry, FileKind, FileStat } from '@pch/shared'
import { toAppError } from '../errors'
import type { FileSystemProvider } from '../types'

/**
 * 本地磁盘、已挂载的网络盘与已认证的 UNC 路径（file://server/share/...）。
 * M1 只读；Windows 的系统隐藏属性需要原生 API，暂以「名称以 . 开头」判断隐藏。
 */
export class LocalProvider implements FileSystemProvider {
  readonly scheme = 'file' as const

  async stat(uri: URL, signal?: AbortSignal): Promise<FileStat> {
    try {
      signal?.throwIfAborted()
      const p = fileURLToPath(uri)
      // stat 跟随符号链接：用于判断目标是目录还是文件
      return toFileStat(p, await fs.stat(p))
    } catch (e) {
      throw toAppError(e)
    }
  }

  async list(uri: URL, signal?: AbortSignal): Promise<FileEntry[]> {
    try {
      signal?.throwIfAborted()
      const dir = fileURLToPath(uri)
      const dirents = await fs.readdir(dir, { withFileTypes: true })
      signal?.throwIfAborted()
      const entries = await Promise.all(
        dirents.map(async (d): Promise<FileEntry | null> => {
          const p = path.join(dir, d.name)
          try {
            // lstat 不跟随符号链接：报告为 symlink，避免循环
            return { ...toFileStat(p, await fs.lstat(p)), hidden: d.name.startsWith('.') }
          } catch {
            // 单项失败（列出后被删除、权限不足等）只跳过该项，不让整个列表失败
            return null
          }
        })
      )
      signal?.throwIfAborted()
      return entries.filter((e): e is FileEntry => e !== null)
    } catch (e) {
      throw toAppError(e)
    }
  }

  async dispose(): Promise<void> {
    // 本地文件系统没有需要释放的连接或句柄
  }
}

function toFileStat(p: string, s: Stats): FileStat {
  const kind: FileKind = s.isSymbolicLink() ? 'symlink' : s.isDirectory() ? 'directory' : 'file'
  return {
    uri: pathToFileURL(p).href,
    name: path.basename(p),
    kind,
    size: kind === 'file' ? s.size : 0,
    mtime: s.mtimeMs
  }
}
