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
}
