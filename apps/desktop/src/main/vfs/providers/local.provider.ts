import fs from 'node:fs/promises'
import type { Dirent, Stats } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type { FileEntry, FileKind, FileStat } from '@pch/shared'
import { toAppError } from '../errors'
import { displayName } from '../path-name'
import type { FileSystemProvider } from '../types'

/**
 * 同时进行的 lstat 上限：libuv 线程池默认只有 4 个线程，一次性排入上万个 lstat 会阻塞
 * 主进程中所有其他文件操作；网络共享上每次 lstat 都是一次网络往返。
 */
const STAT_CONCURRENCY = 16

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
      const entries = await mapLimited(dirents, STAT_CONCURRENCY, signal, (d) => statChild(dir, d))
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

/**
 * 读取一个子项：lstat 不跟随符号链接（报告为 symlink，避免循环）。
 * 列出后被删除（ENOENT）→ 跳过；存在但读不到（权限不足、网络瞬断等）→ 保留并降级，
 * 类型取自 readdir 的结果，避免文件在列表中「消失」。
 */
async function statChild(dir: string, d: Dirent): Promise<FileEntry | null> {
  const p = path.join(dir, d.name)
  const hidden = d.name.startsWith('.')
  try {
    return { ...toFileStat(p, await fs.lstat(p)), hidden }
  } catch (e) {
    if ((e as { code?: string }).code === 'ENOENT') return null
    const kind: FileKind = d.isSymbolicLink() ? 'symlink' : d.isDirectory() ? 'directory' : 'file'
    return { uri: pathToFileURL(p).href, name: d.name, kind, size: 0, mtime: 0, hidden }
  }
}

/** 以有限并发依次处理；每开始一项前检查中止信号，中止后不再开始新的工作 */
async function mapLimited<T, R>(
  items: T[],
  limit: number,
  signal: AbortSignal | undefined,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      signal?.throwIfAborted()
      const i = next++
      results[i] = await fn(items[i] as T)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
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
