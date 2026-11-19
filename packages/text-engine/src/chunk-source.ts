// 按块读取字节窗口（line-reader 内部使用）：缓存最近一块；同一次读取中块大小从 64KB 倍增到 1MB，
// 读取少量行时少读字节，长距离扫描时少调用 readAt（主进程的 readAt 每次都是「打开 → 读 → 关闭」）。
import type { ReadAt } from './types'

const MIN_CHUNK = 64 * 1024
const MAX_CHUNK = 1024 * 1024

export interface Chunk {
  /** bytes[0] 在文件中的偏移 */
  base: number
  bytes: Uint8Array
}

export class ChunkSource {
  private current: Chunk = { base: 0, bytes: new Uint8Array(0) }
  private size = MIN_CHUNK

  /**
   * @param limit 读取的终点（不含），即索引的 indexedTo
   * @param align 块长度的对齐（UTF-16 为 2）：未到 limit 的块保持偶数长度，使后续块的起点仍对齐
   */
  constructor(
    private readonly readAt: ReadAt,
    readonly limit: number,
    private readonly align: 1 | 2
  ) {}

  /** 包含 pos 的块；pos ≥ limit 或读不到数据（文件变短）时为 null */
  async at(pos: number): Promise<Chunk | null> {
    const { base, bytes } = this.current
    if (pos >= base && pos < base + bytes.length) return this.current
    if (pos >= this.limit) return null
    const length = Math.min(this.size, this.limit - pos)
    this.size = Math.min(this.size * 2, MAX_CHUNK)
    let read = await this.readAt(pos, length)
    if (read.length > length) read = read.subarray(0, length)
    if (read.length % this.align !== 0 && pos + read.length < this.limit) {
      read = read.subarray(0, read.length - (read.length % this.align))
    }
    if (read.length === 0) return null
    this.current = { base: pos, bytes: read }
    return this.current
  }
}
