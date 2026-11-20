import { afterEach, describe, expect, it } from 'vitest'
import {
  AppError,
  type DocChangedEvent,
  type DocProgressEvent,
  type DocumentInfo,
  type FileStat
} from '@pch/shared'
import { PARTIAL_WINDOW_BYTES } from './document-window'
import {
  DocumentService,
  type DocumentServiceOptions,
  type DocumentSource
} from './document-service'

const MB = 1024 * 1024
const URI = 'file:///C:/logs/app.log'
const OWNER = 1

const enc = (text: string): Uint8Array => new TextEncoder().encode(text)
const cat = (...parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}
const utf16le = (text: string): Uint8Array =>
  Uint8Array.from(text.split('').flatMap((c) => [c.charCodeAt(0) & 0xff, c.charCodeAt(0) >> 8]))
const hex = (h: string): Uint8Array => Uint8Array.from(h.match(/../g)!.map((b) => parseInt(b, 16)))

/** 固定宽度（16 字节）的 ASCII 行：第 i 行为 `L0000000i______\n` */
const LINE = 16
const fixedLines = (count: number, from = 0): Uint8Array => {
  const out = new Uint8Array(count * LINE)
  for (let i = 0; i < count; i++) {
    out.set(enc(`L${String(from + i).padStart(8, '0')}______\n`), i * LINE)
  }
  return out
}

/** 内存中的文件：stat / read 与 provider 语义相同（越过末尾返回更短的结果，不存在 → FS_NOT_FOUND） */
class MemoryFiles implements DocumentSource {
  readonly files = new Map<string, { bytes: Uint8Array; mtime: number }>()
  readonly reads: { offset: number; length: number }[] = []
  /** 每次 read 返回之前调用（可修改文件、推进时钟、抛出错误） */
  onRead?: (offset: number, length: number) => void | Promise<void>

  put(uri: string, bytes: Uint8Array, mtime = 1): void {
    this.files.set(uri, { bytes, mtime })
  }

  append(uri: string, bytes: Uint8Array): void {
    const f = this.files.get(uri)!
    this.put(uri, cat(f.bytes, bytes), f.mtime + 1)
  }

  async stat(uri: string): Promise<FileStat> {
    const f = this.files.get(uri)
    if (!f) throw new AppError({ code: 'FS_NOT_FOUND', detail: uri })
    return { uri, name: 'app.log', kind: 'file', size: f.bytes.length, mtime: f.mtime }
  }

  async read(uri: string, offset: number, length: number): Promise<Uint8Array> {
    this.reads.push({ offset, length })
    await this.onRead?.(offset, length)
    const f = this.files.get(uri)
    if (!f) throw new AppError({ code: 'FS_NOT_FOUND', detail: uri })
    return f.bytes.slice(offset, offset + length)
  }
}

interface Setup {
  files: MemoryFiles
  docs: DocumentService
  progress: (DocProgressEvent & { at: number; owner: number })[]
  changed: (DocChangedEvent & { owner: number })[]
  clock: { now: number }
}

let current: DocumentService | null = null
afterEach(() => {
  current?.dispose()
  current = null
})

function setup(opts: Partial<DocumentServiceOptions> = {}): Setup {
  const files = new MemoryFiles()
  const clock = { now: 0 }
  const progress: Setup['progress'] = []
  const changed: Setup['changed'] = []
  let seq = 0
  const docs = new DocumentService({
    source: files,
    emit: (owner, event, payload) => {
      if (event === 'doc.progress') {
        progress.push({ ...(payload as DocProgressEvent), at: clock.now, owner })
      } else changed.push({ ...(payload as DocChangedEvent), owner })
    },
    fullIndexLimitBytes: () => 50 * MB,
    preferredLanguage: () => 'ja',
    now: () => clock.now,
    newId: () => `doc-${++seq}`,
    ...opts
  })
  current = docs
  return { files, docs, progress, changed, clock }
}

/** 等待条件成立（后台索引在微任务 / 宏任务中推进） */
async function until(predicate: () => boolean, what = 'condition'): Promise<void> {
  for (let i = 0; i < 2000; i++) {
    if (predicate()) return
    await new Promise((r) => setTimeout(r, 0))
  }
  throw new Error(`timed out waiting for ${what}`)
}

/** 调用之后出现的完成事件（在触发重建的调用之前取得，避免完成事件早于等待开始） */
const completed = (s: Setup, docId: string): (() => boolean) => {
  const start = s.progress.length
  return () => s.progress.slice(start).some((p) => p.docId === docId && p.complete)
}
const everCompleted =
  (s: Setup, docId: string): (() => boolean) =>
  () =>
    s.progress.some((p) => p.docId === docId && p.complete)

async function openAndIndex(
  s: Setup,
  input: Parameters<DocumentService['open']>[1] = { uri: URI }
): Promise<DocumentInfo> {
  const info = await s.docs.open(OWNER, input)
  await until(() => s.progress.some((p) => p.docId === info.docId && p.complete), 'index complete')
  return s.docs.refresh(OWNER, info.docId)
}

const text = (bytes: Uint8Array): string => new TextDecoder().decode(bytes)

describe('DocumentService: open and read', () => {
  it('opens a small file in full mode, indexes it and reads lines', async () => {
    const s = setup()
    s.files.put(URI, enc('a\nbb\r\nccc'), 42)
    const opened = await s.docs.open(OWNER, { uri: URI })
    expect(opened).toMatchObject({
      docId: 'doc-1',
      uri: URI,
      size: 9,
      mtime: 42,
      encoding: { label: 'utf-8', confidence: 'likely', bomLength: 0, manual: false },
      binary: false,
      mode: 'full',
      window: { start: 0, end: 9 }
    })
    const info = await openAndIndex(s)
    expect(info.index).toEqual({ lines: 3, complete: true, indexedTo: 9 })
    const block = await s.docs.readLines(OWNER, info.docId, 0, 10)
    expect(block.start).toBe(0)
    expect(text(block.bytes)).toBe('a\nbb\r\nccc')
    expect(block.starts).toEqual([0, 2, 6])
    expect(block.ends).toEqual([1, 4, 9])
    expect(block.truncated).toEqual([])
  })

  it('reports a BOM as certain with its length, and flags binary content', async () => {
    const s = setup()
    s.files.put(URI, cat(Uint8Array.of(0xef, 0xbb, 0xbf), enc('x\n')))
    const bom = await s.docs.open(OWNER, { uri: URI })
    expect(bom.encoding).toEqual({
      label: 'utf-8',
      confidence: 'certain',
      bomLength: 3,
      manual: false
    })
    const bin = 'file:///C:/a.bin'
    s.files.put(bin, Uint8Array.of(0x50, 0x4b, 0x03, 0x04, 0x00, 0x00, 0x01))
    expect((await s.docs.open(OWNER, { uri: bin })).binary).toBe(true)
  })

  it('rejects a missing file with FS_NOT_FOUND', async () => {
    const s = setup()
    await expect(s.docs.open(OWNER, { uri: URI })).rejects.toMatchObject({ code: 'FS_NOT_FOUND' })
  })

  it('reports progress at most every 200ms, right after the first chunk and at completion', async () => {
    const s = setup()
    const total = Math.floor((5.5 * MB) / LINE)
    s.files.put(URI, fixedLines(total))
    s.files.onRead = () => {
      s.clock.now += 70
    }
    const info = await s.docs.open(OWNER, { uri: URI })
    await until(everCompleted(s, info.docId))
    const events = s.progress.filter((p) => p.docId === info.docId)
    expect(events[0]).toMatchObject({ indexedTo: MB, complete: false })
    const last = events[events.length - 1]!
    expect(last).toMatchObject({ complete: true, lines: total, indexedTo: total * LINE })
    const partial = events.filter((e) => !e.complete)
    for (let i = 1; i < partial.length; i++) {
      expect(partial[i]!.at - partial[i - 1]!.at).toBeGreaterThanOrEqual(200)
    }
    expect(partial.length).toBeLessThan(6)
    expect(events.every((e) => e.owner === OWNER)).toBe(true)
  })

  it('reads the index in 1MB chunks', async () => {
    const s = setup()
    s.files.put(URI, fixedLines((2.5 * MB) / LINE))
    await openAndIndex(s)
    const big = s.files.reads.filter((r) => r.length === MB).map((r) => r.offset)
    expect(big).toEqual([0, MB])
  })
})

describe('DocumentService: full / partial mode', () => {
  const total = (6 * MB) / LINE

  it('indexes the whole file when it is within preview.maxTextSizeMB', async () => {
    const s = setup({ fullIndexLimitBytes: () => 10 * MB })
    s.files.put(URI, fixedLines(total))
    const info = await openAndIndex(s, { uri: URI, at: 'end' })
    expect(info.mode).toBe('full')
    expect(info.index).toMatchObject({ lines: total, complete: true })
  })

  it('takes the first 4MB, ending at a line end, for at: start', async () => {
    const s = setup({ fullIndexLimitBytes: () => MB })
    s.files.put(URI, cat(enc('x'), fixedLines(total)))
    const info = await openAndIndex(s, { uri: URI, at: 'start' })
    expect(info.mode).toBe('partial')
    expect(info.window.start).toBe(0)
    expect(info.window.end).toBeLessThanOrEqual(PARTIAL_WINDOW_BYTES)
    expect((info.window.end - 1) % LINE).toBe(0)
    expect(info.index).toMatchObject({ complete: true, indexedTo: info.window.end })
    expect(info.index.lines).toBe((info.window.end - 1) / LINE)
  })

  it('takes the last 4MB, starting at a line start, for at: end', async () => {
    const s = setup({ fullIndexLimitBytes: () => MB })
    s.files.put(URI, cat(enc('x'), fixedLines(total)))
    const info = await openAndIndex(s, { uri: URI, at: 'end' })
    expect(info.mode).toBe('partial')
    expect(info.window.end).toBe(1 + total * LINE)
    expect(info.window.start).toBeGreaterThanOrEqual(info.window.end - PARTIAL_WINDOW_BYTES)
    expect((info.window.start - 1) % LINE).toBe(0)
    const block = await s.docs.readLines(OWNER, info.docId, 0, 1)
    expect(text(block.bytes)).toMatch(/^L\d{8}______\n$/)
  })

  it('switches to full with doc.buildIndex', async () => {
    const s = setup({ fullIndexLimitBytes: () => MB })
    s.files.put(URI, fixedLines(total))
    const partial = await openAndIndex(s, { uri: URI, at: 'end' })
    const done = completed(s, partial.docId)
    const full = await s.docs.buildIndex(OWNER, partial.docId)
    expect(full.mode).toBe('full')
    expect(full.window).toEqual({ start: 0, end: total * LINE })
    await until(done)
    const info = await s.docs.refresh(OWNER, partial.docId)
    expect(info.index).toMatchObject({ lines: total, complete: true })
  })

  for (const bom of [true, false]) {
    it(`starts a UTF-16LE tail window on an even offset after a newline unit (${bom ? 'BOM' : 'no BOM'})`, async () => {
      const s = setup({ fullIndexLimitBytes: () => MB })
      // 32 字节。只有假名的无 BOM UTF-16LE 与 ASCII 无法区分（U+30xx 的两个字节都是 ASCII），
      // 因此行中含 ASCII（NUL 集中在奇数位）
      const line = utf16le('log line: あいうえお\n')
      const body = new Uint8Array(5 * MB)
      for (let i = 0; i + line.length <= body.length; i += line.length) body.set(line, i)
      // 大小为奇数（末尾多 1 个字节）：末尾 4MB 的起点不调整就是奇数
      const file = cat(
        bom ? Uint8Array.of(0xff, 0xfe) : new Uint8Array(0),
        body,
        Uint8Array.of(0x41)
      )
      s.files.put(URI, file)
      const info = await openAndIndex(s, { uri: URI, at: 'end' })
      expect(info.encoding.label).toBe('utf-16le')
      expect(info.encoding.bomLength).toBe(0)
      expect(info.window.start % 2).toBe(0)
      expect([...file.subarray(info.window.start - 2, info.window.start)]).toEqual([0x0a, 0x00])
      const block = await s.docs.readLines(OWNER, info.docId, 0, 1)
      expect(new TextDecoder('utf-16le').decode(block.bytes)).toBe('log line: あいうえお\n')
    })
  }
})

describe('DocumentService: refresh', () => {
  it('does not misalign when the file grows during the scan, then indexes the new part on refresh', async () => {
    const s = setup()
    const original = (3 * MB) / LINE
    s.files.put(URI, fixedLines(original))
    let grown = false
    s.files.onRead = (offset, length) => {
      // 索引的第一块（1MB）读取时增长：打开时 stat 得到的窗口不变
      if (offset === 0 && length === MB && !grown) {
        grown = true
        s.files.append(URI, fixedLines(1000, original))
      }
    }
    const info = await openAndIndex(s)
    expect(info.size).toBe(original * LINE + 1000 * LINE)
    // 打开时的窗口只到原来的大小；增长部分由刷新发现
    const first = s.progress.find((p) => p.complete)!
    expect(first).toMatchObject({ lines: original, indexedTo: original * LINE })
    expect(s.changed).toContainEqual({ docId: info.docId, appended: true, owner: OWNER })
    await until(() => s.progress.filter((p) => p.complete).length >= 2, 'second completion')
    const after = await s.docs.refresh(OWNER, info.docId)
    expect(after.index).toEqual({ lines: original + 1000, complete: true, indexedTo: after.size })
    for (const at of [original - 1, original, original + 999]) {
      const block = await s.docs.readLines(OWNER, info.docId, at, 1)
      expect(text(block.bytes)).toBe(`L${String(at).padStart(8, '0')}______\n`)
    }
  })

  it('appended: continues from the last indexed position; an unterminated last line is extended', async () => {
    const s = setup()
    s.files.put(URI, enc('x\nab'))
    const info = await openAndIndex(s)
    expect(info.index.lines).toBe(2)
    const before = s.files.reads.length
    s.files.append(URI, enc('c\nd\n'))
    const refreshed = await s.docs.refresh(OWNER, info.docId)
    expect(refreshed.size).toBe(8)
    expect(s.changed).toEqual([{ docId: info.docId, appended: true, owner: OWNER }])
    await until(() => s.progress.filter((p) => p.complete).length >= 2)
    const after = await s.docs.refresh(OWNER, info.docId)
    expect(after.index).toEqual({ lines: 3, complete: true, indexedTo: 8 })
    // 续扫只读新增部分（另有一次开头 4KB 的读取用于判断身份）
    const scanned = s.files.reads.slice(before).filter((r) => r.offset > 0)
    expect(scanned).toEqual([{ offset: 4, length: 4 }])
    const block = await s.docs.readLines(OWNER, info.docId, 0, 3)
    expect(text(block.bytes)).toBe('x\nabc\nd\n')
  })

  it('reset: a smaller file is re-indexed from scratch', async () => {
    const s = setup()
    s.files.put(URI, enc('one\ntwo\nthree\n'))
    const info = await openAndIndex(s)
    s.files.put(URI, enc('one\n'), 2)
    const refreshed = await s.docs.refresh(OWNER, info.docId)
    expect(s.changed).toEqual([{ docId: info.docId, reset: true, owner: OWNER }])
    expect(refreshed.size).toBe(4)
    await until(() => s.progress.filter((p) => p.complete).length >= 2)
    expect((await s.docs.refresh(OWNER, info.docId)).index).toEqual({
      lines: 1,
      complete: true,
      indexedTo: 4
    })
  })

  it('reset: a changed head (rotated and refilled) is re-indexed even if the file grew', async () => {
    const s = setup()
    s.files.put(URI, enc('2026-11-19 a\n'))
    const info = await openAndIndex(s)
    s.files.put(URI, enc('2026-11-20 a\n2026-11-20 b\n'), 2)
    await s.docs.refresh(OWNER, info.docId)
    expect(s.changed).toEqual([{ docId: info.docId, reset: true, owner: OWNER }])
  })

  it('missing: a deleted file is reported and the document stays usable', async () => {
    const s = setup()
    s.files.put(URI, enc('a\nb\n'))
    const info = await openAndIndex(s)
    s.files.files.delete(URI)
    const refreshed = await s.docs.refresh(OWNER, info.docId)
    expect(s.changed).toEqual([{ docId: info.docId, missing: true, owner: OWNER }])
    expect(refreshed.size).toBe(4)
    expect(refreshed.index.lines).toBe(2)
    // 自动刷新反复检查：只在变为不存在时通知一次
    await s.docs.refresh(OWNER, info.docId)
    expect(s.changed).toHaveLength(1)
    // 同样的内容又出现：reset（渲染端离开「文件已不存在」）
    s.files.put(URI, enc('a\nb\n'))
    await s.docs.refresh(OWNER, info.docId)
    expect(s.changed[1]).toEqual({ docId: info.docId, reset: true, owner: OWNER })
  })

  it('unchanged: nothing is emitted', async () => {
    const s = setup()
    s.files.put(URI, enc('a\nb\n'))
    const info = await openAndIndex(s)
    await s.docs.refresh(OWNER, info.docId)
    expect(s.changed).toEqual([])
  })

  it('reset: a read failing in the middle of the rebuild leaves the old state, so the next refresh resets again', async () => {
    const s = setup()
    // 超过 64KB：重建时除开头外还要读中间 / 末尾的样本
    const rows = (256 * 1024) / LINE
    s.files.put(URI, fixedLines(rows))
    const info = await openAndIndex(s)
    // 轮转：新文件的开头不同（行号从 500000 起）
    s.files.put(URI, fixedLines(rows, 500_000), 2)
    let failing = true
    s.files.onRead = (offset) => {
      // 开头的读取（身份判断、文件开头）成功，之后的样本读取超时（UNC 上轮转时常见）
      if (failing && offset > 0) throw new AppError({ code: 'FS_TIMEOUT' })
    }
    await expect(s.docs.refresh(OWNER, info.docId)).rejects.toMatchObject({ code: 'FS_TIMEOUT' })
    expect(s.changed).toEqual([])
    failing = false
    const done = completed(s, info.docId)
    await s.docs.refresh(OWNER, info.docId)
    expect(s.changed).toEqual([{ docId: info.docId, reset: true, owner: OWNER }])
    await until(done)
    const block = await s.docs.readLines(OWNER, info.docId, 0, 1)
    expect(text(block.bytes)).toBe('L00500000______\n')
  })

  it('missing → back: a failed rebuild keeps reporting the file as gone until a rebuild succeeds', async () => {
    const s = setup()
    s.files.put(URI, enc('a\nb\n'))
    const info = await openAndIndex(s)
    s.files.files.delete(URI)
    await s.docs.refresh(OWNER, info.docId)
    s.files.put(URI, enc('a\nb\n'))
    // 文件开头（FILE_HEAD_BYTES）的读取失败；身份判断的 4KB 读取成功
    s.files.onRead = (_offset, length) => {
      if (length > 4096) throw new AppError({ code: 'FS_TIMEOUT' })
    }
    await expect(s.docs.refresh(OWNER, info.docId)).rejects.toMatchObject({ code: 'FS_TIMEOUT' })
    s.files.onRead = undefined
    await s.docs.refresh(OWNER, info.docId)
    expect(s.changed.slice(1)).toEqual([{ docId: info.docId, reset: true, owner: OWNER }])
  })

  it('reset: the file shrinking during the scan triggers a rebuild', async () => {
    const s = setup()
    s.files.put(URI, fixedLines((3 * MB) / LINE))
    s.files.onRead = (offset) => {
      if (offset === MB) s.files.put(URI, fixedLines(10), 2)
    }
    const info = await s.docs.open(OWNER, { uri: URI })
    await until(() => s.changed.some((c) => c.reset), 'reset after shrinking')
    s.files.onRead = undefined
    await until(() => s.progress.some((p) => p.complete && p.lines === 10), 'rebuilt index')
    expect((await s.docs.refresh(OWNER, info.docId)).index.lines).toBe(10)
  })
})

describe('DocumentService: encoding', () => {
  // 「2026-11-20 10:00:00 エラー：データベースに接続できません。設定を確認してください。」+ LF 的 Shift_JIS
  const SJIS_LINE = hex(
    '323032362d31312d32302031303a30303a30302083478389815b81468366815b835e8378815b835882c990da91b182c582ab82dc82b982f1814290dd92e882f08a6d944682b582c482ad82be82b382a281420a'
  )

  it('the Shift_JIS test line really is Shift_JIS and not UTF-8', () => {
    expect(new TextDecoder('shift_jis').decode(SJIS_LINE)).toBe(
      '2026-11-20 10:00:00 エラー：データベースに接続できません。設定を確認してください。\n'
    )
    expect(() => new TextDecoder('utf-8', { fatal: true }).decode(SJIS_LINE)).toThrow()
  })

  it('re-judges an ASCII-headed log as Shift_JIS when the scan meets it, and emits reset', async () => {
    const s = setup()
    // 约 1MB：只在抽样（开头 / 中间 / 末尾各 64KB）覆盖不到的 300KB 附近有 Shift_JIS 的行
    const before = fixedLines((300 * 1024) / LINE)
    const sjis = cat(...Array.from({ length: 20 }, () => SJIS_LINE))
    const after = fixedLines((700 * 1024) / LINE, 100_000)
    s.files.put(URI, cat(before, sjis, after))
    const opened = await s.docs.open(OWNER, { uri: URI })
    expect(opened.encoding).toMatchObject({ label: 'utf-8', manual: false })
    await until(() => s.changed.some((c) => c.reset), 'reset after re-judging')
    expect(s.changed).toEqual([{ docId: opened.docId, reset: true, owner: OWNER }])
    await until(everCompleted(s, opened.docId))
    const info = await s.docs.refresh(OWNER, opened.docId)
    expect(info.encoding.label).toBe('shift_jis')
    expect(info.index.complete).toBe(true)
  })

  it('does not re-judge when the encoding was chosen by hand', async () => {
    const s = setup()
    s.files.put(URI, cat(fixedLines(1000), SJIS_LINE))
    const info = await openAndIndex(s, { uri: URI, encoding: 'utf-8' })
    expect(info.encoding).toEqual({
      label: 'utf-8',
      confidence: 'certain',
      bomLength: 0,
      manual: true
    })
    expect(s.changed).toEqual([])
  })

  it('setEncoding rebuilds the index when switching to / from UTF-16, and not between byte encodings', async () => {
    const s = setup()
    s.files.put(URI, enc('a\nb\nc\n'))
    const info = await openAndIndex(s)
    expect(info.index.lines).toBe(3)

    const wide = await s.docs.setEncoding(OWNER, info.docId, 'utf-16le')
    expect(wide.encoding).toEqual({
      label: 'utf-16le',
      confidence: 'certain',
      bomLength: 0,
      manual: true
    })
    await until(() => s.progress.filter((p) => p.complete).length >= 2)
    // 按 UTF-16LE 读没有 0A 00 单元 → 1 行
    expect((await s.docs.refresh(OWNER, info.docId)).index.lines).toBe(1)

    await s.docs.setEncoding(OWNER, info.docId, 'shift_jis')
    await until(() => s.progress.filter((p) => p.complete).length >= 3)
    expect((await s.docs.refresh(OWNER, info.docId)).index.lines).toBe(3)

    const reads = s.files.reads.length
    const euc = await s.docs.setEncoding(OWNER, info.docId, 'euc-jp')
    expect(euc.encoding.label).toBe('euc-jp')
    expect(euc.index).toEqual({ lines: 3, complete: true, indexedTo: 6 })
    expect(s.files.reads.length).toBe(reads)

    const auto = await s.docs.setEncoding(OWNER, info.docId, null)
    expect(auto.encoding).toEqual({
      label: 'utf-8',
      confidence: 'likely',
      bomLength: 0,
      manual: false
    })
  })

  it('setEncoding failing while re-aligning the window keeps the previous encoding and index', async () => {
    const s = setup({ fullIndexLimitBytes: () => MB })
    s.files.put(URI, fixedLines((6 * MB) / LINE))
    const info = await openAndIndex(s, { uri: URI, at: 'end' })
    expect(info.mode).toBe('partial')
    // 切换到 UTF-16 要重新对齐窗口（读窗口起点附近）：该读取超时
    s.files.onRead = (offset) => {
      if (offset > 0) throw new AppError({ code: 'FS_TIMEOUT' })
    }
    await expect(s.docs.setEncoding(OWNER, info.docId, 'utf-16le')).rejects.toMatchObject({
      code: 'FS_TIMEOUT'
    })
    s.files.onRead = undefined
    const after = await s.docs.refresh(OWNER, info.docId)
    expect(after.encoding).toEqual(info.encoding)
    expect(after.window).toEqual(info.window)
    expect(after.index).toEqual(info.index)
    // 自动判断仍以之前的状态为准：再次切换照常生效
    const wide = await s.docs.setEncoding(OWNER, info.docId, 'utf-16le')
    expect(wide.encoding).toMatchObject({ label: 'utf-16le', manual: true })
  })

  it('keeps the BOM length when the chosen encoding matches the BOM', async () => {
    const s = setup()
    s.files.put(URI, cat(Uint8Array.of(0xff, 0xfe), utf16le('a\n')))
    const info = await s.docs.open(OWNER, { uri: URI, encoding: 'utf-16le' })
    expect(info.encoding).toEqual({
      label: 'utf-16le',
      confidence: 'certain',
      bomLength: 2,
      manual: true
    })
    const other = await s.docs.setEncoding(OWNER, info.docId, 'utf-16be')
    expect(other.encoding.bomLength).toBe(0)
  })

  it('takes the interface language as the tie-break preference', async () => {
    // EUC-JP（設定）/ GB18030 / Big5 都能解码且打分相同的短字节串：平局时按界面语言
    const tie = hex('c0dfc4ea0a')
    for (const [lang, label] of [
      ['ja', 'euc-jp'],
      ['zh-CN', 'gb18030']
    ] as const) {
      const s = setup({ preferredLanguage: () => lang })
      s.files.put(URI, tie)
      expect((await s.docs.open(OWNER, { uri: URI })).encoding.label).toBe(label)
      s.docs.dispose()
    }
  })
})

describe('DocumentService: owners and lifetime', () => {
  it('keeps at most 16 documents per window, closing the least recently used', async () => {
    const s = setup()
    const ids: string[] = []
    for (let i = 0; i < 16; i++) {
      s.files.put(`file:///C:/f${i}.txt`, enc(`${i}\n`))
      ids.push((await s.docs.open(OWNER, { uri: `file:///C:/f${i}.txt` })).docId)
    }
    await until(() => s.progress.filter((p) => p.complete).length >= 16)
    // 使用第一个文档 → 第二个成为最久未用的
    await s.docs.readLines(OWNER, ids[0]!, 0, 1)
    s.files.put('file:///C:/f16.txt', enc('16\n'))
    await s.docs.open(OWNER, { uri: 'file:///C:/f16.txt' })
    await expect(s.docs.readLines(OWNER, ids[1]!, 0, 1)).rejects.toMatchObject({
      code: 'DOC_NOT_FOUND'
    })
    await expect(s.docs.readLines(OWNER, ids[0]!, 0, 1)).resolves.toMatchObject({ start: 0 })
    // 其他窗口的上限分别计算
    s.files.put(URI, enc('x\n'))
    await s.docs.open(2, { uri: URI })
    await expect(s.docs.readLines(OWNER, ids[2]!, 0, 1)).resolves.toMatchObject({ start: 0 })
  })

  it('releases every document of a window; later calls reject with DOC_NOT_FOUND', async () => {
    const s = setup()
    s.files.put(URI, enc('a\n'))
    const mine = await openAndIndex(s)
    const other = await s.docs.open(2, { uri: URI })
    s.docs.releaseOwner(OWNER)
    await expect(s.docs.readLines(OWNER, mine.docId, 0, 1)).rejects.toMatchObject({
      code: 'DOC_NOT_FOUND'
    })
    await expect(s.docs.refresh(OWNER, mine.docId)).rejects.toMatchObject({ code: 'DOC_NOT_FOUND' })
    await expect(s.docs.readLines(2, other.docId, 0, 1)).resolves.toBeDefined()
  })

  it('resetOwner (reload / renderer crash) closes the documents but keeps accepting new ones', async () => {
    const s = setup()
    s.files.put(URI, enc('a\n'))
    const before = await openAndIndex(s)
    const other = await s.docs.open(2, { uri: URI })
    s.docs.resetOwner(OWNER)
    await expect(s.docs.readLines(OWNER, before.docId, 0, 1)).rejects.toMatchObject({
      code: 'DOC_NOT_FOUND'
    })
    await expect(s.docs.readLines(2, other.docId, 0, 1)).resolves.toBeDefined()
    // 重新加载后的页面照常打开
    const after = await s.docs.open(OWNER, { uri: URI })
    await expect(s.docs.readLines(OWNER, after.docId, 0, 1)).resolves.toBeDefined()
  })

  it('resetOwner closes a document whose open was still in flight (the old page never sees it)', async () => {
    const s = setup()
    s.files.put(URI, enc('a\n'))
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    s.files.onRead = () => gate
    const opening = s.docs.open(OWNER, { uri: URI })
    await until(() => s.files.reads.length > 0)
    s.docs.resetOwner(OWNER)
    s.files.onRead = undefined
    release()
    await expect(opening).rejects.toMatchObject({ code: 'DOC_NOT_FOUND' })
    // 被关闭的文档不占上限、不再发事件
    const progressBefore = s.progress.length
    await new Promise((r) => setTimeout(r, 20))
    expect(s.progress.slice(progressBefore)).toEqual([])
  })

  it('emits nothing after close, even from a refresh that was already running (appended / reset)', async () => {
    for (const change of ['appended', 'reset'] as const) {
      const s = setup()
      s.files.put(URI, enc('a\nb\n'))
      const info = await openAndIndex(s)
      if (change === 'appended') s.files.append(URI, enc('c\n'))
      else s.files.put(URI, enc('x\n'), 5)
      let release!: () => void
      const gate = new Promise<void>((r) => (release = r))
      s.files.onRead = () => gate
      const readsBefore = s.files.reads.length
      const refreshing = s.docs.refresh(OWNER, info.docId)
      await until(() => s.files.reads.length > readsBefore)
      s.docs.close(OWNER, info.docId)
      s.files.onRead = undefined
      release()
      await refreshing.catch(() => undefined)
      await new Promise((r) => setTimeout(r, 20))
      expect(s.changed, change).toEqual([])
      current?.dispose()
    }
  })

  it('does not let another window use a document', async () => {
    const s = setup()
    s.files.put(URI, enc('a\n'))
    const info = await s.docs.open(OWNER, { uri: URI })
    await expect(s.docs.readLines(2, info.docId, 0, 1)).rejects.toMatchObject({
      code: 'DOC_NOT_FOUND'
    })
    s.docs.close(2, info.docId)
    await expect(s.docs.readLines(OWNER, info.docId, 0, 1)).resolves.toBeDefined()
  })

  it('stops the background scan when closed', async () => {
    const s = setup()
    s.files.put(URI, fixedLines((4 * MB) / LINE))
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    s.files.onRead = (offset) => (offset === MB ? gate : undefined)
    const info = await s.docs.open(OWNER, { uri: URI })
    await until(() => s.files.reads.some((r) => r.offset === MB))
    s.docs.close(OWNER, info.docId)
    release()
    await new Promise((r) => setTimeout(r, 20))
    expect(s.files.reads.some((r) => r.offset === 2 * MB)).toBe(false)
    expect(s.progress.some((p) => p.complete)).toBe(false)
  })

  it('reports an index failure in doc.progress (error code, not complete) and retries on refresh', async () => {
    const s = setup()
    s.files.put(URI, fixedLines((2 * MB) / LINE))
    // 第二块起所有读取都超时（网络断开）
    let failing = false
    s.files.onRead = (offset) => {
      if (offset === MB) failing = true
      if (failing) throw new AppError({ code: 'FS_TIMEOUT' })
    }
    const info = await s.docs.open(OWNER, { uri: URI })
    await until(() => s.progress.some((p) => p.error), 'error event')
    expect(s.progress.find((p) => p.error)).toMatchObject({
      docId: info.docId,
      complete: false,
      error: 'FS_TIMEOUT',
      indexedTo: MB
    })
    await expect(s.docs.readLines(OWNER, info.docId, 0, 1)).rejects.toMatchObject({
      code: 'FS_TIMEOUT'
    })
    s.files.onRead = undefined
    const done = completed(s, info.docId)
    await s.docs.refresh(OWNER, info.docId)
    await until(done)
  })
})
