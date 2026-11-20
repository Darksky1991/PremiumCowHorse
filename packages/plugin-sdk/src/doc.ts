/**
 * 文本文档（分页模型，设计 devDoc/2026-11-20-18-text-preview-design.md 3.1、3.5、3.7 节）：插件经 PreviewHost.doc 使用。
 * 主进程按字节窗口建立行索引、按行返回原始字节；解码在插件中做（@pch/text-engine 的 decodeBlock）。
 *
 * 这里的类型与 @pch/shared 的同名类型结构相同（SDK 不依赖 shared）；DocLineBlock 与 @pch/text-engine 的 LineBlock
 * 同构（可直接交给 decodeBlock）。渲染端的类型测试保证一致。
 */

/** 支持的文本编码（WHATWG Encoding 标签，可直接交给 TextDecoder） */
export type DocEncoding =
  | 'utf-8'
  | 'utf-16le'
  | 'utf-16be'
  | 'shift_jis'
  | 'euc-jp'
  | 'iso-2022-jp'
  | 'gb18030'
  | 'big5'
  | 'windows-1252'

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
    /** 用户手动指定（open 的 encoding / setEncoding） */
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
 * readLines 的结果：
 * - start：第一行的行号（窗口内，从 0 起）
 * - bytes：各行字节按顺序拼接。未截断的行含原有的行尾；截断的行（超过 64KB）只含保留的前缀
 * - starts / ends：每行在 bytes 内的起点与内容终点（ends 不含 `\n` 与紧挨其前的 `\r`）
 * - truncated：被截断的行的行号（与 start 同为窗口内行号，不是块内下标）
 */
export interface DocLineBlock {
  start: number
  bytes: Uint8Array
  starts: number[]
  ends: number[]
  truncated: number[]
}

/** 索引进度（节流 ≥ 200ms；完成时与出错时必发）。error 为错误码（例如 FS_TIMEOUT），刷新时重试 */
export interface DocProgress {
  docId: string
  indexedTo: number
  lines: number
  complete: boolean
  error?: string
}

/**
 * 文档的变化（宿主的自动刷新、地址栏刷新 / F5，以及主进程自行发现的变化都经此通知；没有变化时不通知）：
 * - appended：文件只增长，新增部分已开始索引（行数随 onProgress 增加）
 * - reset：文件被截断 / 替换 / 开头变化，或编码判断改变。行号的含义变了：清空已缓存的行，按 info 重新显示
 * - missing：文件已不存在（保留已缓存的内容）。宿主照常按间隔检查，同名文件重新出现（日志轮转）时为 reset
 * - info：变化之后的文档信息（宿主刷新取得）。reset 到达时宿主先不带 info 立即通知一次（插件立即丢弃已缓存的行，
 *   在 info 到达之前不读取：行数与编码还是旧的），刷新取得 info 后再带 info 通知（仍含 reset）。
 *   刷新失败（超时等）时 info 留到之后成功的刷新
 */
export interface DocChange {
  docId: string
  appended?: true
  reset?: true
  missing?: true
  info?: DocumentInfo
}

/**
 * readLines 的结果已过期：发出之后文档发生了 reset（或 setEncoding / buildIndex 完成），行号的含义变了。
 * 宿主以它拒绝，插件忽略即可（不要显示为错误）
 */
export class DocStaleError extends Error {
  readonly code = 'DOC_STALE'

  constructor(docId: string) {
    super(`DOC_STALE: ${docId}`)
    this.name = 'DocStaleError'
  }
}

/** 文本文档 API（宿主负责自动刷新：插件不自己计时） */
export interface PreviewDocApi {
  /**
   * 打开文档：stat + 判断编码 + 开始后台索引，返回前已索引第一块。
   * at：超过 preview.maxTextSizeMB 时取开头还是末尾的窗口（默认开头）；encoding：手动指定的编码。
   * 文档归属本标签：插件卸载前应 close；标签内容卸载时宿主关闭仍打开的文档
   */
  open(uri: string, opts?: { encoding?: DocEncoding; at?: 'start' | 'end' }): Promise<DocumentInfo>
  /**
   * 第 start 行起的 count 行（count ≤ 2000；不超过已确定的行数）。
   * 结果到达前文档发生了 reset（onChanged）或 setEncoding / buildIndex 完成时，以 DocStaleError 拒绝；
   * 文档已关闭（含因每窗口 16 个的上限被关闭）时以带 code DOC_NOT_FOUND 的错误拒绝
   */
  readLines(docId: string, start: number, count: number): Promise<DocLineBlock>
  /**
   * 手动指定编码（null = 恢复自动判断）。切换到 / 离开 UTF-16 时重建索引：
   * 插件按返回的 info 清空已缓存的行；进行中的 readLines 以 DocStaleError 拒绝
   */
  setEncoding(docId: string, encoding: DocEncoding | null): Promise<DocumentInfo>
  /** 部分模式 → 全量（行号的含义改变：同 setEncoding，清空已缓存的行） */
  buildIndex(docId: string): Promise<DocumentInfo>
  /** 关闭文档（不再自动刷新、不再回调）；之后的调用以 DOC_NOT_FOUND 拒绝 */
  close(docId: string): void
  /** 索引进度；返回取消订阅函数 */
  onProgress(docId: string, cb: (p: DocProgress) => void): () => void
  /**
   * 文档的变化（见 DocChange）；返回取消订阅函数。
   * 收到 reset 时插件必须丢弃所有已缓存的行：IPC 事件与 readLines 应答的先后没有保证，
   * 在 reset 之前到达的应答可能已是新索引的内容、也可能是旧的，DocStaleError 只覆盖 reset 之后才到达的应答
   */
  onChanged(docId: string, cb: (c: DocChange) => void): () => void
}
