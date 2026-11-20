// 打开的文本文档表（设计 3.1、3.7 节）：文档归属调用方窗口（owner = webContents id），
// 每个窗口最多 16 个（超出时关闭最久未用的），窗口销毁时全部释放，页面重新加载 / 渲染进程崩溃时也全部关闭；
// 事件只发给所属窗口。
import { randomUUID } from 'node:crypto'
import {
  AppError,
  type DocEncoding,
  type DocLineBlock,
  type DocumentInfo,
  type FileStat,
  type IpcEvents,
  type Language
} from '@pch/shared'
import { TextDocument, type OpenOptions, type TextDocumentDeps } from './text-document'

/** 文档读取文件用到的 VfsService 部分（测试可注入内存实现） */
export interface DocumentSource {
  stat(uri: string): Promise<FileStat>
  read(uri: string, offset: number, length: number, signal?: AbortSignal): Promise<Uint8Array>
}

export type DocumentEvent = 'doc.progress' | 'doc.changed'

export interface DocumentServiceOptions {
  source: DocumentSource
  /** 把事件发给 owner 对应的窗口 */
  emit<E extends DocumentEvent>(owner: number, event: E, payload: IpcEvents[E]): void
  /** 自动建立完整行索引的上限（字节）：组合根按 preview.maxTextSizeMB 取 */
  fullIndexLimitBytes(): number
  /** 当前界面语言（编码判断平局时的偏好） */
  preferredLanguage(): Language
  now?: () => number
  /** 每个窗口最多打开的文档数；默认 16 */
  maxPerOwner?: number
  /** doc.progress 的最小间隔；默认 200ms */
  progressIntervalMs?: number
  newId?: () => string
}

const MAX_PER_OWNER = 16
const PROGRESS_INTERVAL_MS = 200

interface Entry {
  doc: TextDocument
  owner: number
}

export class DocumentService {
  private readonly docs = new Map<string, Entry>()
  /** owner → 其文档 id（插入顺序 = 最近使用顺序，最旧的在前） */
  private readonly owners = new Map<number, Set<string>>()
  /** 已销毁的窗口（webContents id 不会复用）：在其销毁后才完成的 open 立即关闭 */
  private readonly released = new Set<number>()
  /** owner → 页面代号（resetOwner 递增）：在旧页面发起、新页面开始后才完成的 open 立即关闭 */
  private readonly generations = new Map<number, number>()

  constructor(private readonly opts: DocumentServiceOptions) {}

  async open(
    owner: number,
    input: { uri: string; encoding?: DocEncoding; at?: 'start' | 'end' }
  ): Promise<DocumentInfo> {
    const id = (this.opts.newId ?? randomUUID)()
    const generation = this.generations.get(owner) ?? 0
    const options: OpenOptions = { encoding: input.encoding, at: input.at }
    const doc = await TextDocument.open(id, input.uri, options, this.depsFor(owner, id))
    if (this.released.has(owner) || (this.generations.get(owner) ?? 0) !== generation) {
      doc.close()
      throw new AppError({ code: 'DOC_NOT_FOUND', detail: id })
    }
    const ids = this.owners.get(owner) ?? new Set<string>()
    this.owners.set(owner, ids)
    const max = this.opts.maxPerOwner ?? MAX_PER_OWNER
    for (const oldest of ids) {
      if (ids.size < max) break
      this.close(owner, oldest)
    }
    ids.add(id)
    this.docs.set(id, { doc, owner })
    return doc.info()
  }

  readLines(owner: number, docId: string, start: number, count: number): Promise<DocLineBlock> {
    return this.use(owner, docId, (doc) => doc.readLines(start, count))
  }

  refresh(owner: number, docId: string): Promise<DocumentInfo> {
    return this.use(owner, docId, async (doc) => {
      await doc.refresh()
      return doc.info()
    })
  }

  setEncoding(owner: number, docId: string, encoding: DocEncoding | null): Promise<DocumentInfo> {
    return this.use(owner, docId, async (doc) => {
      await doc.setEncoding(encoding)
      return doc.info()
    })
  }

  buildIndex(owner: number, docId: string): Promise<DocumentInfo> {
    return this.use(owner, docId, async (doc) => {
      await doc.buildIndex()
      return doc.info()
    })
  }

  /** 关闭文档；不存在或不属于该窗口时不做任何事 */
  close(owner: number, docId: string): void {
    const entry = this.docs.get(docId)
    if (!entry || entry.owner !== owner) return
    entry.doc.close()
    this.docs.delete(docId)
    this.owners.get(owner)?.delete(docId)
  }

  /**
   * 页面重新加载 / 导航、渲染进程崩溃：关闭其全部文档（新页面不知道旧的 docId），
   * 旧页面发起、尚未完成的 open 完成时也关闭。之后的 open 照常受理
   */
  resetOwner(owner: number): void {
    this.generations.set(owner, (this.generations.get(owner) ?? 0) + 1)
    for (const id of [...(this.owners.get(owner) ?? [])]) this.close(owner, id)
    this.owners.delete(owner)
  }

  /** 窗口销毁：关闭其全部文档，之后完成的 open 也关闭 */
  releaseOwner(owner: number): void {
    this.released.add(owner)
    this.resetOwner(owner)
    this.generations.delete(owner)
  }

  dispose(): void {
    for (const { doc } of this.docs.values()) doc.close()
    this.docs.clear()
    this.owners.clear()
  }

  /** 取得该窗口的文档并记为最近使用；不存在 → DOC_NOT_FOUND */
  private use<T>(owner: number, docId: string, op: (doc: TextDocument) => Promise<T>): Promise<T> {
    const entry = this.docs.get(docId)
    if (!entry || entry.owner !== owner) {
      return Promise.reject(new AppError({ code: 'DOC_NOT_FOUND', detail: docId }))
    }
    const ids = this.owners.get(owner)
    ids?.delete(docId)
    ids?.add(docId)
    return op(entry.doc)
  }

  private depsFor(owner: number, docId: string): TextDocumentDeps {
    const { source, emit } = this.opts
    return {
      stat: (uri) => source.stat(uri),
      read: (uri, offset, length, signal) => source.read(uri, offset, length, signal),
      fullIndexLimitBytes: () => this.opts.fullIndexLimitBytes(),
      preferredLanguage: () => this.opts.preferredLanguage(),
      now: this.opts.now ?? Date.now,
      progressIntervalMs: this.opts.progressIntervalMs ?? PROGRESS_INTERVAL_MS,
      emitProgress: (event) => emit(owner, 'doc.progress', { docId, ...event }),
      emitChanged: (event) => emit(owner, 'doc.changed', { docId, ...event })
    }
  }
}
