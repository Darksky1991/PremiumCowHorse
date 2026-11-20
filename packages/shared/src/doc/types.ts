import { z } from 'zod'

/**
 * 文本文档（文本 / 日志预览的分页模型，设计 devDoc/2026-11-20-18-text-preview-design.md 3.1、3.7 节）。
 * 主进程按字节窗口建立行索引、按行返回原始字节；解码在渲染端（@pch/text-engine 的 decodeBlock）。
 */

/**
 * 支持的文本编码（WHATWG Encoding 标签，可直接交给 TextDecoder）。
 * `@pch/text-engine` 的 ENCODING_LABELS 是同一集合（两包互不依赖），由主进程的类型测试保证一致
 */
export const DOC_ENCODINGS = z.enum([
  'utf-8',
  'utf-16le',
  'utf-16be',
  'shift_jis',
  'euc-jp',
  'iso-2022-jp',
  'gb18030',
  'big5',
  'windows-1252'
])
export type DocEncoding = z.infer<typeof DOC_ENCODINGS>

/** doc.readLines 一次最多读取的行数 */
export const DOC_READ_LINES_MAX = 2000

export interface DocumentInfo {
  docId: string
  uri: string
  /** 打开 / 最近一次刷新时的文件大小（字节） */
  size: number
  /** 打开 / 最近一次刷新时的修改时间（UNIX 毫秒） */
  mtime: number
  encoding: {
    label: DocEncoding
    /** certain：BOM 或手动指定；likely：判断有把握；guess：界面提示「编码可能不正确」 */
    confidence: 'certain' | 'likely' | 'guess'
    /** 窗口起点处的 BOM 字节数：解码从窗口起点开始的块时跳过。窗口不从文件开头开始时为 0 */
    bomLength: number
    /** 用户手动指定（doc.open 的 encoding / doc.setEncoding） */
    manual: boolean
  }
  /** 开头 8KB 判为二进制（插件提示，可强制按文本） */
  binary: boolean
  /**
   * full：窗口 = 整个文件，打开即建立完整行索引；partial：文件超过 preview.maxTextSizeMB，
   * 只对开头或末尾约 4MB（对齐到行边界）建索引，行号为窗口内的行号
   */
  mode: 'full' | 'partial'
  /** 当前文档对应的字节窗口 [start, end)（文件中的绝对偏移） */
  window: { start: number; end: number }
  /** lines：已确定的行数；indexedTo：已索引到的绝对偏移（不含） */
  index: { lines: number; complete: boolean; indexedTo: number }
}

/**
 * doc.readLines 的结果（与 @pch/text-engine 的 LineBlock 同构，可直接交给 decodeBlock）：
 * - start：第一行的行号（窗口内，从 0 起）
 * - bytes：各行字节按顺序拼接。未截断的行含原有的行尾（`\r\n` / `\n`）；截断的行（超过 64KB）只含保留的前缀，
 *   因此 bytes 不一定是文件中连续的一段
 * - starts / ends：每行在 bytes 内的起点与内容终点（ends 不含 `\n` 与紧挨其前的 `\r`；UTF-16 按 2 字节单元）
 * - truncated：被截断的行的**行号**（与 start 同为窗口内的绝对行号，不是块内下标）
 */
export interface DocLineBlock {
  start: number
  bytes: Uint8Array
  starts: number[]
  ends: number[]
  truncated: number[]
}

/** doc.progress：索引进度（节流 ≥ 200ms；完成时与出错时必发）。error 为错误码（例如 FS_TIMEOUT） */
export interface DocProgressEvent {
  docId: string
  indexedTo: number
  lines: number
  complete: boolean
  error?: string
}

/**
 * doc.changed：appended = 文件只增长，新增部分已开始索引；reset = 文件被截断 / 替换 / 开头变化，
 * 或编码判断改变（渲染端清空缓存、重新取 DocumentInfo）；missing = 文件已不存在（保留已缓存内容）
 */
export interface DocChangedEvent {
  docId: string
  appended?: true
  reset?: true
  missing?: true
}

/** vfs.sniff 的结果：开头 8KB 判为文本 / 二进制 / 空文件 */
export interface SniffInfo {
  kind: 'text' | 'binary' | 'empty'
}
