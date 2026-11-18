import type { FileEntry, FileStat } from '@pch/shared'

/**
 * 文件系统 Provider（架构文档 7.1 节的子集）。M2 增加 createReadStream，M1-2 增加 watch，
 * M4 增加 smb / ftp / sftp。新增一种资源类型只需新增一个 provider 并在组合根注册。
 */
export interface FileSystemProvider {
  readonly scheme: 'file'
  stat(uri: URL, signal?: AbortSignal): Promise<FileStat>
  list(uri: URL, signal?: AbortSignal): Promise<FileEntry[]>
  /**
   * 监听目录内容变化（不区分具体事件）；无法监听时返回空操作句柄，不抛出。
   * 监听自行失效（初始就无法监听，或运行中目录被删除 / 失去权限）时调用 onClose 一次：
   * 运行中失效会先调用 onChange 再调用 onClose；初始失败可能在 watch 返回之前同步调用 onClose。
   * 调用方主动 close() 不触发 onClose。
   */
  watch?(uri: URL, onChange: () => void, onClose?: () => void): { close(): void }
  dispose(): Promise<void>
}
