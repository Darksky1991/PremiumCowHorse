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
