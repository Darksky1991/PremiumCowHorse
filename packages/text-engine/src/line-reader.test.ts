import { describe, expect, it } from 'vitest'
import { LineIndex } from './line-index'
import { readLines } from './line-reader'
import type { LineBlock } from './types'
import { blockLines, buildIndex, memoryReadAt, utf16, utf8 } from './test-utils'

const MB = 1024 * 1024

/** 建索引并按行读取（数据整体在内存中） */
async function read(
  bytes: Uint8Array,
  start: number,
  count: number,
  limits?: { maxBytes?: number; maxLineBytes?: number }
): Promise<{ block: LineBlock; stats: { calls: number; bytes: number }; index: LineIndex }> {
  const index = buildIndex(bytes)
  const { readAt, stats } = memoryReadAt(bytes)
  const block = await readLines(index, readAt, start, count, limits)
  return { block, stats, index }
}

describe('readLines：行边界', () => {
  it('LF / CRLF 混合：ends 不含 \\n 与前面的 \\r，末尾无换行的行也返回', async () => {
    const { block } = await read(utf8('a\r\nbb\n\nccc'), 0, 10)
    expect(block.start).toBe(0)
    expect(blockLines(block)).toEqual(['a', 'bb', '', 'ccc'])
    expect(block.truncated).toEqual([])
  })

  it('starts / ends 是 bytes 内的偏移', async () => {
    const { block } = await read(utf8('a\r\nbb\n'), 0, 2)
    expect(block.starts).toEqual([0, 3])
    expect(block.ends).toEqual([1, 5])
  })

  it('\\r 与 \\n 落在读取的两个块之间时也去掉 \\r', async () => {
    // 第一次读取 64KB：\r 在其最后一个字节，\n 在下一块
    const content = 64 * 1024 - 1
    const bytes = new Uint8Array(content + 3).fill(0x61)
    bytes.set(utf8('\r\nz'), content)
    const { block } = await read(bytes, 0, 2)
    expect(block.ends[0]! - block.starts[0]!).toBe(content)
    expect(blockLines(block)[1]).toBe('z')
    expect(block.truncated).toEqual([])
  })

  it('UTF-16LE / BE：按单元去掉 \\r\\n', async () => {
    const text = 'ab\r\n\u0a0a\u010a\ncd'
    for (const [endian, unit, label] of [
      ['le', 'utf16le', 'utf-16le'],
      ['be', 'utf16be', 'utf-16be']
    ] as const) {
      const bytes = utf16(text, endian)
      const index = buildIndex(bytes, { unit }, { chunkSize: 3 })
      const block = await readLines(index, memoryReadAt(bytes).readAt, 0, 10)
      expect(blockLines(block, label)).toEqual(['ab', '\u0a0a\u010a', 'cd'])
    }
  })

  it('窗口起点非 0：按文件中的绝对偏移读取', async () => {
    const file = utf8('junk\nA\r\nB\nC')
    const windowStart = 5
    const index = buildIndex(file.subarray(windowStart), { unit: 'byte' }, { windowStart })
    const block = await readLines(index, memoryReadAt(file).readAt, 1, 5)
    expect(block.start).toBe(1)
    expect(blockLines(block)).toEqual(['B', 'C'])
  })
})

describe('readLines：范围', () => {
  const numbered = (n: number): Uint8Array =>
    utf8(Array.from({ length: n }, (_, i) => `line ${i}\n`).join(''))

  it('跨检查点读取', async () => {
    const { block, index } = await read(numbered(2500), 995, 10)
    expect(index.checkpointFor(1000).line).toBe(1000)
    expect(blockLines(block)).toEqual(Array.from({ length: 10 }, (_, i) => `line ${995 + i}`))
  })

  it('从检查点跳到起始行：读取量不超过约一个检查点间隔', async () => {
    const bytes = numbered(100_000)
    const { block, stats } = await read(bytes, 54_321, 3)
    expect(blockLines(block)).toEqual(['line 54321', 'line 54322', 'line 54323'])
    // 1000 行 × 约 11 字节 ≈ 11KB；按最小块 64KB 读取
    expect(stats.bytes).toBeLessThanOrEqual(64 * 1024)
  })

  it('count 超出末尾时只返回已有的行；start 在末尾或之后时返回空块', async () => {
    expect(blockLines((await read(numbered(5), 3, 10)).block)).toEqual(['line 3', 'line 4'])
    for (const start of [5, 10]) {
      const { block, stats } = await read(numbered(5), start, 1)
      expect(block).toEqual({
        start,
        bytes: new Uint8Array(0),
        starts: [],
        ends: [],
        truncated: []
      })
      expect(stats.calls).toBe(0)
    }
    expect((await read(numbered(5), 0, 0)).block.starts).toEqual([])
  })

  it('索引未完成时只返回已确定的行', async () => {
    const bytes = utf8('a\nb\nc')
    const index = buildIndex(bytes, { unit: 'byte' }, { finish: false })
    const block = await readLines(index, memoryReadAt(bytes).readAt, 0, 10)
    expect(blockLines(block)).toEqual(['a', 'b'])
  })

  it('start 为负数时抛出', async () => {
    const { readAt } = memoryReadAt(utf8('a\n'))
    await expect(readLines(buildIndex(utf8('a\n')), readAt, -1, 1)).rejects.toThrow(RangeError)
  })
})

describe('readLines：上限', () => {
  it('超过 64KB 的行被截断并列入 truncated（下一行无检查点：继续扫描）', async () => {
    const long = 70_000
    const bytes = new Uint8Array(long + 6).fill(0x61)
    bytes.set(utf8('\nnext\n'), long)
    const { block, index } = await read(bytes, 0, 2)
    expect(index.checkpointFor(1).line).toBe(0)
    expect(block.ends[0]! - block.starts[0]!).toBe(65_536)
    expect(block.truncated).toEqual([0])
    expect(blockLines(block)[1]).toBe('next')
  })

  it('截断的行之后的下一行有检查点时直接跳过去，读取量有界', async () => {
    const long = 5 * MB
    const bytes = new Uint8Array(long + 12).fill(0x61)
    bytes.set(utf8('\nnext\nlast\n'), long)
    const { block, stats } = await read(bytes, 0, 3)
    expect(blockLines(block).slice(1)).toEqual(['next', 'last'])
    expect(block.truncated).toEqual([0])
    expect(stats.bytes).toBeLessThan(MB)
  })

  it('truncated 为绝对行号', async () => {
    const bytes = utf8(`a\nb\n${'x'.repeat(100)}\nc\n`)
    const { block } = await read(bytes, 1, 3, { maxLineBytes: 10 })
    expect(block.truncated).toEqual([2])
    expect(blockLines(block)).toEqual(['b', 'x'.repeat(10), 'c'])
  })

  it('UTF-16 的截断长度按单元对齐', async () => {
    const bytes = utf16(`${'あ'.repeat(20)}\nz`, 'le')
    const index = buildIndex(bytes, { unit: 'utf16le' })
    const block = await readLines(index, memoryReadAt(bytes).readAt, 0, 2, { maxLineBytes: 7 })
    expect(blockLines(block, 'utf-16le')).toEqual(['あああ', 'z'])
    expect(block.truncated).toEqual([0])
  })

  it('总量超过 4MB 时提前结束（至少返回一行）', async () => {
    const line = 'y'.repeat(60_000) + '\n'
    const bytes = utf8(line.repeat(100))
    const { block } = await read(bytes, 0, 100)
    const n = block.starts.length
    expect(n).toBeGreaterThan(0)
    expect(n).toBeLessThan(100)
    expect(block.bytes.length).toBeLessThanOrEqual(4 * MB)
    expect(block.bytes.length + line.length).toBeGreaterThan(4 * MB)
    const tiny = await read(bytes, 0, 100, { maxBytes: 10 })
    expect(tiny.block.starts.length).toBe(1)
  })

  it('20MB 无换行的单行：readLines(0, 10) 只读取有界字节', async () => {
    const bytes = new Uint8Array(20 * MB).fill(0x62)
    const { block, stats } = await read(bytes, 0, 10)
    expect(block.starts).toEqual([0])
    expect(block.ends).toEqual([65_536])
    expect(block.truncated).toEqual([0])
    expect(stats.bytes).toBeLessThan(2 * MB)
  })

  it('文件在读取期间变短（readAt 返回不足）时返回已读到的行，不抛出', async () => {
    const bytes = utf8('a\nb\nc\n')
    const index = buildIndex(bytes)
    const { readAt } = memoryReadAt(bytes.subarray(0, 3))
    const block = await readLines(index, readAt, 0, 3)
    expect(blockLines(block)).toEqual(['a'])
  })
})

describe('readLines：与增量索引配合', () => {
  it('reopen 并追加后读到延长的末行', async () => {
    const file = utf8('a\nbcd\ne')
    const index = new LineIndex(0, { unit: 'byte' })
    index.feed(file.subarray(0, 4), 0)
    index.finish(4)
    index.reopen()
    index.feed(file.subarray(4), 4)
    index.finish(file.length)
    const block = await readLines(index, memoryReadAt(file).readAt, 0, 5)
    expect(blockLines(block)).toEqual(['a', 'bcd', 'e'])
  })
})
