import type { FileEntry, FileStat } from '@pch/shared'

/**
 * 文件系统 Provider（架构文档 7.1 节的子集）。M2 增加 createReadStream，M1-2 增加 watch，
 * M4 增加 smb / ftp / sftp。新增一种资源类型只需新增一个 provider 并在组合根注册。
 */
export interface FileSystemProvider {
  readonly scheme: 'file'
  stat(uri: URL, signal?: AbortSignal): Promise<FileStat>
  list(uri: URL, signal?: AbortSignal): Promise<FileEntry[]>
  /** 监听目录内容变化（不区分具体事件）；无法监听时返回空操作句柄，不抛出 */
  watch?(uri: URL, onChange: () => void): { close(): void }
  dispose(): Promise<void>
}
