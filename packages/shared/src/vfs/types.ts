export type FileKind = 'file' | 'directory' | 'symlink'

export interface FileStat {
  uri: string
  name: string
  kind: FileKind
  /** 字节数；目录为 0 */
  size: number
  /** 修改时间（UNIX 毫秒） */
  mtime: number
}

export interface FileEntry extends FileStat {
  hidden: boolean
  /** 仅 kind 为 symlink 时存在：链接目标的类型；null 表示目标不存在或无法解析（失效链接） */
  target?: 'file' | 'directory' | null
}

/**
 * 目录列表（扫描进程的缓存 + 状态）：
 * - fresh：本次调用中刚完成枚举，或 2 秒内确认过
 * - cached：缓存内容，尚未在 2 秒内确认（调度器已安排检查）
 * - offline：所在共享断开，内容为缓存，不发起访问
 * checkedAt：上次检查的时刻（Unix 毫秒）；没有记录时为 null
 */
export interface DirectoryListing {
  items: FileEntry[]
  state: 'fresh' | 'cached' | 'offline'
  checkedAt: number | null
}
