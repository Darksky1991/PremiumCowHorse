import fs from 'node:fs/promises'
import type { Dirent } from 'node:fs'
import path from 'node:path'
import { AppError, type FileKind } from '@pch/shared'

/**
 * 用 node:fs 列出目录的直接子项（不依赖 electron）：LocalProvider.list 与扫描进程的
 * fs 回退枚举器共用，两者对同一目录得到相同的名称、类型、target、size、mtime。
 * hidden 与 URI 由调用方决定。
 */

/**
 * 同时进行的 lstat 上限：libuv 线程池默认只有 4 个线程，一次性排入上万个 lstat 会阻塞
 * 进程中所有其他文件操作；网络共享上每次 lstat 都是一次网络往返。
 */
export const STAT_CONCURRENCY = 16

export interface ListedChild {
  name: string
  kind: FileKind
  /** 文件的字节数；目录与链接为 0 */
  size: number
  mtime: number
  /** 只有 symlink 才有：目标类型，目标不存在或无法读取时为 null */
  target?: 'file' | 'directory' | null
}

/**
 * 已中止则抛出：中止原因是 AppError（如 VfsService 的 FS_TIMEOUT）时原样抛出，
 * 否则为 FS_CANCELLED。
 */
export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return
  const reason: unknown = signal.reason
  throw reason instanceof AppError ? reason : new AppError({ code: 'FS_CANCELLED' })
}

/** readdir + 有限并发的 lstat；抛出的 Node 错误由调用方用 toAppError 转换 */
export async function listChildren(dir: string, signal?: AbortSignal): Promise<ListedChild[]> {
  throwIfAborted(signal)
  const dirents = await fs.readdir(dir, { withFileTypes: true })
  const children = await mapLimited(dirents, STAT_CONCURRENCY, signal, (d) => statChild(dir, d))
  throwIfAborted(signal)
  return children.filter((c): c is ListedChild => c !== null)
}

/**
 * 读取一个子项：lstat 不跟随符号链接（报告为 symlink，避免循环）。
 * 列出后被删除（ENOENT）→ 跳过；存在但读不到（权限不足、网络瞬断等）→ 保留并降级，
 * 类型取自 readdir 的结果，避免文件在列表中「消失」。
 */
async function statChild(dir: string, d: Dirent): Promise<ListedChild | null> {
  const p = path.join(dir, d.name)
  try {
    const s = await fs.lstat(p)
    const kind: FileKind = s.isSymbolicLink() ? 'symlink' : s.isDirectory() ? 'directory' : 'file'
    const base: ListedChild = {
      name: d.name,
      kind,
      size: kind === 'file' ? s.size : 0,
      mtime: s.mtimeMs
    }
    if (kind !== 'symlink') return base
    return { ...base, target: await resolveTarget(p) }
  } catch (e) {
    if ((e as { code?: string }).code === 'ENOENT') return null
    const kind: FileKind = d.isSymbolicLink() ? 'symlink' : d.isDirectory() ? 'directory' : 'file'
    return { name: d.name, kind, size: 0, mtime: 0 }
  }
}

/** 跟随链接取目标类型；目标不存在或无法读取（失效链接、循环、权限）一律视为 null */
export async function resolveTarget(p: string): Promise<'file' | 'directory' | null> {
  try {
    return (await fs.stat(p)).isDirectory() ? 'directory' : 'file'
  } catch {
    return null
  }
}

/** 以有限并发依次处理；每开始一项前检查中止信号，中止后不再开始新的工作 */
export async function mapLimited<T, R>(
  items: T[],
  limit: number,
  signal: AbortSignal | undefined,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      throwIfAborted(signal)
      const i = next++
      results[i] = await fn(items[i] as T)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}
