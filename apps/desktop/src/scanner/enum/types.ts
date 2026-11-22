import type { LocationKind, RawEntry } from '@pch/shared'

/**
 * RawEntry（一个目录的直接子项）定义在 packages/shared：远程目录的列表经协议（RawEntrySchema）
 * 从主进程传来，类型与 schema 放在一处保持一致；扫描进程各处仍从这里导入。
 */
export type { RawEntry }

export interface Enumerator {
  /** true：使用 koffi 调用 Win32 API；false：回退到 node:fs（复合枚举器取本地部分的值） */
  readonly native: boolean
  /**
   * 目录自身的修改时间（跟随链接；不枚举）。
   * userAction：用户操作发起的读取（远程目录断线时重连并重试一次）；本地枚举器忽略
   */
  statDir(
    uri: string,
    signal: AbortSignal,
    opts?: { userAction?: boolean }
  ): Promise<{ mtime: number }>
  /**
   * 列出直接子项（不含 . 与 ..）；每读完一批调用一次 onBatch，批与批之间检查 signal。
   * userAction 同 statDir
   */
  list(
    uri: string,
    opts: { signal: AbortSignal; onBatch: () => void; userAction?: boolean }
  ): Promise<RawEntry[]>
  /** UNC 或 GetDriveTypeW === DRIVE_REMOTE → network；sftp: → remote */
  location(uri: string): LocationKind
  /** '\\\\host\\share'（小写）或 'C:'；sftp: 为连接键 'sftp://<connectionId>' */
  shareKey(uri: string): string
  /** 'host'（小写）、本地盘 'local'，映射的网络盘为盘符本身（如 'Z:'）；sftp: 同 shareKey */
  hostKey(uri: string): string
}
