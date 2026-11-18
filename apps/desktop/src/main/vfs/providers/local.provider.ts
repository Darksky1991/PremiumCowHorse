import fs from 'node:fs/promises'
// 经模块对象调用 watch（而非具名导入），测试可以替换为假的 watcher 以触发异步 error
import fsSync from 'node:fs'
import type { FSWatcher, Stats } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type { FileEntry, FileKind, FileStat } from '@pch/shared'
import { toAppError } from '../errors'
import { listChildren, throwIfAborted } from '../fs-list'
import { displayName } from '../path-name'
import type { FileSystemProvider } from '../types'

/**
 * 本地磁盘、已挂载的网络盘与已认证的 UNC 路径（file://server/share/...）。
 * M1 只读；隐藏按「名称以 . 开头」判断（按 Windows 隐藏属性判断的是扫描进程的
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

  watch(uri: URL, onChange: () => void, onClose?: () => void): { close(): void } {
    let watcher: FSWatcher | null = null
    /** 调用方主动关闭后不再报告任何事件（包括正在确认中的 error） */
    let closedByCaller = false
    const close = (): void => {
      watcher?.close()
      watcher = null
    }
    // 目录已不在：先通知一次变化（让调用方重新 list 并得到 FS_NOT_FOUND 等结果），再关闭并通知失效
    const invalidate = (): void => {
      if (!watcher) return
      close()
      onChange()
      onClose?.()
    }
    try {
      const dir = fileURLToPath(uri)
      watcher = fsSync.watch(dir, { persistent: false }, (eventType) => {
        onChange()
        // 目录自身被删除时平台可能只给 rename 而不给 error：确认目录是否还在
        if (eventType === 'rename') fs.stat(dir).catch(invalidate)
      })
      // 目录被删除、失去访问权限，或位置不支持变更通知（部分 NAS / Samba、WebDAV、网络抖动）时
      // 可能异步发出 error：不向上抛出。先确认目录是否还在——仍在则只报告失效、不通知变化，
      // 否则调用方会重新列出（成功）并重发集合，重建的监听再次报错，形成循环
      watcher.on('error', () => {
        if (!watcher) return
        close()
        fs.stat(dir).then(
          (s) => {
            if (closedByCaller) return
            if (!s.isDirectory()) onChange()
            onClose?.()
          },
          () => {
            if (closedByCaller) return
            onChange()
            onClose?.()
          }
        )
      })
    } catch {
      // 路径不存在、无权限或不是目录：视为不可监听，同样通知失效以便调用方日后重建
      onClose?.()
    }
    return {
      close: () => {
        closedByCaller = true
        close()
      }
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
