import type { FileEntry, FileStat } from '@pch/shared'

/**
 * 文件系统 Provider（架构文档 7.1 节的子集）。M4 增加 smb / ftp / sftp。
 * 目录的持续刷新由扫描进程负责（2026-11-19 起不再使用 fs.watch，provider 没有 watch）。
 * 新增一种资源类型只需新增一个 provider 并在组合根注册。
 */
export interface FileSystemProvider {
  readonly scheme: 'file'
  stat(uri: URL, signal?: AbortSignal): Promise<FileStat>
  list(uri: URL, signal?: AbortSignal): Promise<FileEntry[]>
  /**
   * 读取文件的 [offset, offset + length)；到达文件末尾时返回更短的结果（offset 在末尾之后为空）。
   * 每次调用 = 打开 → 读 → 关闭，不在调用之间持有句柄，打开方式允许他人同时写入 / 删除 / 改名
   */
  read(uri: URL, offset: number, length: number, signal?: AbortSignal): Promise<Uint8Array>
  /**
   * 打开文件并返回读取流（页面里的视频 / 音频等需要 Range，用于 pch-web 协议）。range 为闭区间 [start, end] 字节
   * （同 HTTP Range / Node 的 createReadStream）。只有「打开」阶段受 VfsService 的超时约束；
   * 流结束、出错、被销毁或 signal 中止时必须关闭句柄（不长期持有句柄，打开方式同 read，允许他人改名 / 删除）
   */
  createReadStream(
    uri: URL,
    range?: { start: number; end: number },
    signal?: AbortSignal
  ): Promise<NodeJS.ReadableStream>
  dispose(): Promise<void>
}
