/**
 * 读取一个目录的直接子项（扫描进程用）。不含子项 URI：调用方按与 LocalProvider 相同的方式
 * 由目录 URI 与 name 生成（pathToFileURL(path.join(fileURLToPath(dir), name))），缓存以此为键。
 */
export interface RawEntry {
  name: string
  kind: 'file' | 'directory' | 'symlink'
  /** 只有 symlink 才有：链接目标的类型；目标不存在或无法读取时为 null */
  target?: 'file' | 'directory' | null
  /** 文件的字节数；目录与链接为 0 */
  size: number
  /** 修改时间（Unix 毫秒，可带小数，与 fs.Stats.mtimeMs 相同） */
  mtime: number
  hidden: boolean
}

export interface Enumerator {
  /** true：使用 koffi 调用 Win32 API；false：回退到 node:fs */
  readonly native: boolean
  /** 目录自身的修改时间（跟随链接；不枚举） */
  statDir(uri: string, signal: AbortSignal): Promise<{ mtime: number }>
  /** 列出直接子项（不含 . 与 ..）；每读完一批调用一次 onBatch，批与批之间检查 signal */
  list(uri: string, opts: { signal: AbortSignal; onBatch: () => void }): Promise<RawEntry[]>
  /** UNC 或 GetDriveTypeW === DRIVE_REMOTE → network */
  location(uri: string): 'local' | 'network'
  /** '\\\\host\\share'（小写）或 'C:' */
  shareKey(uri: string): string
  /** 'host'（小写）、本地盘 'local'，映射的网络盘为盘符本身（如 'Z:'） */
  hostKey(uri: string): string
}
