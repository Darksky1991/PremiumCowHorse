import fs from 'node:fs/promises'
import type { Dirent } from 'node:fs'
import path from 'node:path'
import { AppError } from '@pch/shared'
import { toAppError } from '../../main/vfs/errors'
import { fileUriToLocalPath } from '../../main/vfs/local-path'
import { hostKey, location, shareKey } from '../../main/vfs/location'
import type { Enumerator, RawEntry } from './types'

/**
 * 同时进行的 lstat 上限（与 LocalProvider 相同）：libuv 线程池默认只有 4 个线程，
 * 网络共享上每次 lstat 都是一次网络往返。
 */
const STAT_CONCURRENCY = 16

/**
 * koffi 不可用时的回退：readdir + lstat（移植自 LocalProvider.list）。
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
    const { signal } = opts
    try {
      throwIfAborted(signal)
      const dir = fileUriToLocalPath(uri)
      const dirents = await fs.readdir(dir, { withFileTypes: true })
      throwIfAborted(signal)
      const entries = await mapLimited(dirents, STAT_CONCURRENCY, signal, (d) => statChild(dir, d))
      throwIfAborted(signal)
      opts.onBatch()
      return entries.filter((e): e is RawEntry => e !== null)
    } catch (e) {
      throw toAppError(e)
    }
  }

  location = location
  shareKey = shareKey
  hostKey = hostKey
}

/** 中止 → FS_CANCELLED（不依赖 signal.reason 的类型） */
export function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new AppError({ code: 'FS_CANCELLED' })
}

/**
 * 读取一个子项：lstat 不跟随符号链接。列出后被删除（ENOENT）→ 跳过；
 * 存在但读不到（权限不足、网络瞬断等）→ 保留并降级，类型取自 readdir 的结果。
 */
async function statChild(dir: string, d: Dirent): Promise<RawEntry | null> {
  const p = path.join(dir, d.name)
  const hidden = d.name.startsWith('.')
  try {
    const s = await fs.lstat(p)
    const kind = s.isSymbolicLink() ? 'symlink' : s.isDirectory() ? 'directory' : 'file'
    const base: RawEntry = {
      name: d.name,
      kind,
      size: kind === 'file' ? s.size : 0,
      mtime: s.mtimeMs,
      hidden
    }
    if (kind !== 'symlink') return base
    return { ...base, target: await resolveTarget(p) }
  } catch (e) {
    if ((e as { code?: string }).code === 'ENOENT') return null
    const kind = d.isSymbolicLink() ? 'symlink' : d.isDirectory() ? 'directory' : 'file'
    return { name: d.name, kind, size: 0, mtime: 0, hidden }
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
  signal: AbortSignal,
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
