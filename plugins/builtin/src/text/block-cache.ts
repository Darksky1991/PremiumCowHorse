/**
 * 解码后的行的缓存（设计 3.5）：按 blockLines（默认 1000）行分块，块内稀疏（readLines 可能只返回一部分），
 * LRU，按字符数设上限（默认约 2000 万字符）。纯逻辑，不知道文档与请求。
 *
 * 追加：原来的最后一行可能没有换行、追加后变长——dropFrom 丢掉它及之后的行；
 * 丢弃发生时仍在途的请求（stamp 早于丢弃）的应答不会把旧内容写回丢弃点之后。
 */
export interface CachedLine {
  text: string
  /** 原行被截断（读取上限 64KB，或解码后超过显示的字符上限） */
  truncated: boolean
  /** 解码结果含 U+FFFD（编码可能不对） */
  replaced: boolean
}

/** 一次请求：第 block 块中从 start 起的 count 行 */
export interface BlockRequest {
  block: number
  start: number
  count: number
}

export const BLOCK_LINES = 1000
export const MAX_CACHED_CHARS = 20_000_000

interface Block {
  lines: Map<number, CachedLine>
  chars: number
}

export class BlockCache {
  private readonly blockLines: number
  private readonly maxChars: number
  /** Map 的插入顺序即使用顺序（最近使用的在最后） */
  private readonly blocks = new Map<number, Block>()
  private total = 0
  private version = 0
  /** 最近的丢弃：version 为丢弃之后的版本 */
  private drops: Array<{ version: number; line: number }> = []

  constructor(opts: { maxChars?: number; blockLines?: number } = {}) {
    this.maxChars = opts.maxChars ?? MAX_CACHED_CHARS
    this.blockLines = opts.blockLines ?? BLOCK_LINES
  }

  /** 缓存的字符总数 */
  get chars(): number {
    return this.total
  }

  /** 发出请求时取得，put 时交回（判断请求在途期间是否发生过丢弃） */
  stamp(): number {
    return this.version
  }

  blockOf(line: number): number {
    return Math.floor(line / this.blockLines)
  }

  get(line: number): CachedLine | undefined {
    const index = this.blockOf(line)
    const block = this.blocks.get(index)
    if (!block) return undefined
    this.blocks.delete(index)
    this.blocks.set(index, block)
    return block.lines.get(line)
  }

  /** 写入从 start 起的行（可跨块）；超过上限时淘汰最久未用的块（刚写入的块不淘汰） */
  put(start: number, lines: readonly CachedLine[], stamp: number): void {
    const limit = this.dropLimit(stamp)
    let last = -1
    lines.forEach((line, i) => {
      const n = start + i
      if (n >= limit) return
      const index = this.blockOf(n)
      let block = this.blocks.get(index)
      if (!block) {
        block = { lines: new Map(), chars: 0 }
      }
      this.blocks.delete(index)
      this.blocks.set(index, block)
      const old = block.lines.get(n)
      const delta = line.text.length - (old?.text.length ?? 0)
      block.lines.set(n, line)
      block.chars += delta
      this.total += delta
      last = index
    })
    this.evict(last)
  }

  /**
   * [from, to) 中缺的行（不超过 total）：每块一个请求，从块中第一个缺的行到块尾。
   * 块内缺的行之后已有的行也会重新请求（简单，且一次请求最多 blockLines 行）
   */
  missing(from: number, to: number, total: number): BlockRequest[] {
    const end = Math.min(to, total)
    const requests: BlockRequest[] = []
    for (let line = Math.max(0, from); line < end;) {
      const index = this.blockOf(line)
      const blockEnd = Math.min((index + 1) * this.blockLines, total)
      const lines = this.blocks.get(index)?.lines
      let first = -1
      for (let n = line; n < Math.min(end, blockEnd); n++) {
        if (!lines?.has(n)) {
          first = n
          break
        }
      }
      if (first >= 0) requests.push({ block: index, start: first, count: blockEnd - first })
      line = blockEnd
    }
    return requests
  }

  /** 丢掉第 line 行及之后的行（追加时原来的最后一行可能变长） */
  dropFrom(line: number): void {
    this.version++
    this.drops.push({ version: this.version, line })
    if (this.drops.length > 64) this.drops = this.drops.slice(-64)
    for (const [index, block] of this.blocks) {
      for (const [n, cached] of block.lines) {
        if (n < line) continue
        block.lines.delete(n)
        block.chars -= cached.text.length
        this.total -= cached.text.length
      }
      if (block.lines.size === 0) this.blocks.delete(index)
    }
  }

  /** 全部丢掉（之前发出的请求的应答也不再写入） */
  clear(): void {
    this.dropFrom(0)
  }

  /** stamp 之后发生的丢弃中最小的丢弃点（之后的行不写入）；没有时为 Infinity */
  private dropLimit(stamp: number): number {
    let limit = Infinity
    for (const drop of this.drops) if (drop.version > stamp) limit = Math.min(limit, drop.line)
    return limit
  }

  private evict(keep: number): void {
    for (const [index, block] of this.blocks) {
      if (this.total <= this.maxChars) return
      if (index === keep) continue
      this.blocks.delete(index)
      this.total -= block.chars
    }
  }
}
