import fs from 'node:fs/promises'
import type { Stats } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type { FileEntry, FileKind, FileStat } from '@pch/shared'
import { toAppError } from '../errors'
import { listChildren, throwIfAborted } from '../fs-list'
import { displayName } from '../path-name'
import type { FileSystemProvider } from '../types'

/**
 * 本地磁盘、已挂载的网络盘与已认证的 UNC 路径（file://server/share/...）。
 * M1 只读、一次性调用（不监听：2026-11-19 起目录的持续刷新由扫描进程负责）。
 * 隐藏按「名称以 . 开头」判断（按 Windows 隐藏属性判断的是扫描进程的
 * koffi 枚举器 scanner/enum/win32-enumerator.ts）。
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
      throwIfAborted(signal)
      const dir = fileURLToPath(uri)
      // 读取子项的逻辑与扫描进程的 fs 回退枚举器共用（fs-list.ts）
      const children = await listChildren(dir, signal)
      return children.map((c) => ({
        uri: pathToFileURL(path.join(dir, c.name)).href,
        ...c,
        hidden: c.name.startsWith('.')
      }))
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
    name: displayName(p),
    kind,
    size: kind === 'file' ? s.size : 0,
    mtime: s.mtimeMs
  }
}
