import type { FileEntry, FileStat } from '@pch/shared'

/**
 * 文件系统 Provider（架构文档 7.1 节的子集）。M2 增加 createReadStream，M4 增加 smb / ftp / sftp。
 * 目录的持续刷新由扫描进程负责（2026-11-19 起不再使用 fs.watch，provider 没有 watch）。
 * 新增一种资源类型只需新增一个 provider 并在组合根注册。
 */
export interface FileSystemProvider {
  readonly scheme: 'file'
  stat(uri: URL, signal?: AbortSignal): Promise<FileStat>
  list(uri: URL, signal?: AbortSignal): Promise<FileEntry[]>
  dispose(): Promise<void>
}
