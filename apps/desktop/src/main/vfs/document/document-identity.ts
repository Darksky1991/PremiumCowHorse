// 刷新时判断文件发生了什么（设计 3.6 节）。只用大小、修改时间与开头字节，不依赖 provider 特有的身份信息
// （ino / birthtime 在网络位置与将来的 FTP / SFTP 上未必可靠）。

/** 用于判断「是否还是同一个文件」的开头字节数 */
export const HEAD_BYTES = 4096

export interface FileSnapshot {
  size: number
  mtime: number
  /** 开头 min(HEAD_BYTES, size) 字节 */
  head: Uint8Array
}

export type FileChange = 'unchanged' | 'appended' | 'reset' | 'missing'

/**
 * - 不存在 → missing
 * - 变小，或开头字节（打开时已知的部分）不同 → reset（截断、轮转、被替换）
 * - 只增长 → appended（从已索引处续扫）
 * - 大小相同但修改时间变了 → reset（原地改写：内容可能在开头之后变化）
 */
export function judgeChange(before: FileSnapshot, after: FileSnapshot | null): FileChange {
  if (!after) return 'missing'
  if (after.size < before.size || !startsWith(after.head, before.head)) return 'reset'
  if (after.size > before.size) return 'appended'
  return after.mtime === before.mtime ? 'unchanged' : 'reset'
}

function startsWith(bytes: Uint8Array, prefix: Uint8Array): boolean {
  if (bytes.length < prefix.length) return false
  for (let i = 0; i < prefix.length; i++) if (bytes[i] !== prefix[i]) return false
  return true
}
