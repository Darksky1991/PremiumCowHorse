import { AppError, type FileEntry, type FileStat, type RawEntry } from '@pch/shared'

/** 扫描进程的远程读取请求（ScannerClient 收到 remoteOp 时调用） */
export interface RemoteOpRequest {
  op: 'stat' | 'list'
  uri: string
  userAction: boolean
}

/** SftpProvider 中用到的部分 */
export interface RemoteOpProvider {
  stat(uri: URL, signal: AbortSignal, opts: { userAction: boolean }): Promise<FileStat>
  list(uri: URL, signal: AbortSignal, opts: { userAction: boolean }): Promise<FileEntry[]>
}

/**
 * FileEntry → RawEntry：按字段复制（去掉 uri；扫描进程的 RawEntrySchema 是 strictObject，多余字段会被拒绝）
 */
function toRawEntry(e: FileEntry): RawEntry {
  const r: RawEntry = {
    name: e.name,
    kind: e.kind,
    size: e.size,
    mtime: e.mtime,
    hidden: e.hidden
  }
  if (e.target !== undefined) r.target = e.target
  if (e.owner !== undefined) r.owner = e.owner
  return r
}

/**
 * 主进程为扫描进程代读远程目录（设计 devDoc/2026-11-22-37 第 4.1、5.6 节）：
 * 先按访问范围检查（范围外 IPC_FORBIDDEN；有根更新在途时等待），再经 SftpProvider 读取。
 * - stat → { mtime }；不是目录 → FS_NOT_A_DIRECTORY
 * - list → 去掉 uri 字段的条目（RawEntry：子项 URI 由扫描进程按同一函数生成；保留 owner / target）
 */
export function createRemoteOp(deps: {
  access: { check(uri: string): Promise<void> }
  provider: RemoteOpProvider
}): (req: RemoteOpRequest, signal: AbortSignal) => Promise<unknown> {
  return async ({ op, uri, userAction }, signal) => {
    await deps.access.check(uri)
    const url = new URL(uri)
    if (op === 'stat') {
      const s = await deps.provider.stat(url, signal, { userAction })
      if (s.kind !== 'directory') throw new AppError({ code: 'FS_NOT_A_DIRECTORY', detail: uri })
      return { mtime: s.mtime }
    }
    const items = await deps.provider.list(url, signal, { userAction })
    return items.map(toRawEntry)
  }
}
