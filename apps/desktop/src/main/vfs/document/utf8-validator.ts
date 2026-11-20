// 流式 UTF-8 校验（设计 3.4 第 3 条）：全量模式建索引时对全部内容继续校验，找出抽样没有覆盖到的非法字节。
// 规则与 WHATWG UTF-8 解码器（TextDecoder fatal）一致：拒绝过长形式、代理区、> U+10FFFF、孤立的后续字节。

export interface Utf8Violation {
  /** 第一个非法序列的起点（文件中的绝对偏移） */
  offset: number
  /** 该处所在行的行首（之前最后一个 LF 之后；还没有遇到 LF 时为第一次 feed 的起点） */
  lineStart: number
}

export class Utf8Validator {
  private needed = 0
  private seen = 0
  private lower = 0x80
  private upper = 0xbf
  private seqStart = 0
  private lineStart = -1

  /**
   * 喂入从 offset 开始的字节（按顺序、不留空隙）。返回第一个非法序列；合法为 null。
   * 末尾不完整的序列不算非法（剩余字节可能还在写入），留到下一次 feed
   */
  feed(bytes: Uint8Array, offset: number): Utf8Violation | null {
    if (this.lineStart < 0) this.lineStart = offset
    for (let i = 0; i < bytes.length; i++) {
      const b = bytes[i]!
      if (this.needed === 0) {
        if (b < 0x80) {
          if (b === 0x0a) this.lineStart = offset + i + 1
          continue
        }
        this.seqStart = offset + i
        if (b >= 0xc2 && b <= 0xdf) this.needed = 1
        else if (b >= 0xe0 && b <= 0xef) {
          if (b === 0xe0) this.lower = 0xa0
          if (b === 0xed) this.upper = 0x9f
          this.needed = 2
        } else if (b >= 0xf0 && b <= 0xf4) {
          if (b === 0xf0) this.lower = 0x90
          if (b === 0xf4) this.upper = 0x8f
          this.needed = 3
        } else return this.violation()
        continue
      }
      if (b < this.lower || b > this.upper) return this.violation()
      this.lower = 0x80
      this.upper = 0xbf
      if (++this.seen === this.needed) this.needed = this.seen = 0
    }
    return null
  }

  private violation(): Utf8Violation {
    return { offset: this.seqStart, lineStart: this.lineStart }
  }
}
