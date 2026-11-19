// text-engine 的公共类型。本包不依赖任何包，也不使用 Node / DOM / Electron 专有 API。

/**
 * 支持的文本编码（WHATWG Encoding 标签，可直接交给 TextDecoder）。
 * `@pch/shared` 的 IPC 契约中另有一份同样的列表（两包互不依赖），由主进程的类型测试保证一致。
 */
export type EncodingLabel =
  | 'utf-8'
  | 'utf-16le'
  | 'utf-16be'
  | 'shift_jis'
  | 'euc-jp'
  | 'iso-2022-jp'
  | 'gb18030'
  | 'big5'
  | 'windows-1252'

export const ENCODING_LABELS: readonly EncodingLabel[] = [
  'utf-8',
  'utf-16le',
  'utf-16be',
  'shift_jis',
  'euc-jp',
  'iso-2022-jp',
  'gb18030',
  'big5',
  'windows-1252'
]

/**
 * 换行的识别单位：`byte` = 按字节找 0x0A（UTF-8 与各旧编码中 0x0A 不会出现在多字节字符内部）；
 * `utf16le` / `utf16be` = 按 2 字节单元找 U+000A（单元相对窗口起点对齐）。
 */
export type NewlineUnit = 'byte' | 'utf16le' | 'utf16be'

/** 读取文件中 [offset, offset + length) 的字节；到达文件末尾时可返回更短的结果 */
export type ReadAt = (offset: number, length: number) => Promise<Uint8Array>

/** readLines 的结果：若干行的原始字节与行边界 */
export interface LineBlock {
  /** 第一行的行号（窗口内，从 0 起） */
  start: number
  /**
   * 各行字节按顺序拼接。未截断的行含原有的行尾（`\r\n` / `\n`）；截断的行只含保留的前缀。
   * UTF-16 时每行在 bytes 内的起点都按 2 字节对齐。
   */
  bytes: Uint8Array
  /** 每行在 bytes 内的起点 */
  starts: number[]
  /** 每行内容在 bytes 内的终点（不含 `\n` 与紧挨其前的 `\r`；UTF-16 按单元） */
  ends: number[]
  /** 被截断（只返回前 maxLineBytes 字节）的行的行号（与 start 同为窗口内行号，不是块内下标） */
  truncated: number[]
}
