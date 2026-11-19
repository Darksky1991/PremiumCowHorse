import { describe, expect, it } from 'vitest'
import { LineIndex } from './line-index'
import { buildIndex, utf16, utf8 } from './test-utils'

describe('LineIndex：按字节切行', () => {
  it('LF：每个换行确定一行，finish 后不多计空的末行', () => {
    const index = buildIndex(utf8('a\nbb\nccc\n'), { unit: 'byte' }, { finish: false })
    expect(index.lines).toBe(3)
    expect(index.indexedTo).toBe(9)
    expect(index.complete).toBe(false)
    index.finish(9)
    expect(index.lines).toBe(3)
    expect(index.complete).toBe(true)
  })

  it('CRLF 与混合换行：只按 \\n 切行', () => {
    expect(buildIndex(utf8('a\r\nb\r\n')).lines).toBe(2)
    expect(buildIndex(utf8('a\nb\r\nc')).lines).toBe(3)
  })

  it('\\r\\n 恰好跨两次 feed', () => {
    const index = new LineIndex(0, { unit: 'byte' })
    index.feed(utf8('a\r'), 0)
    expect(index.lines).toBe(0)
    index.feed(utf8('\nb'), 2)
    expect(index.lines).toBe(1)
    index.finish(4)
    expect(index.lines).toBe(2)
  })

  it('末尾无换行的部分在 finish 后计为一行', () => {
    const index = buildIndex(utf8('abc'), { unit: 'byte' }, { finish: false })
    expect(index.lines).toBe(0)
    index.finish(3)
    expect(index.lines).toBe(1)
  })

  it('空文件为 0 行', () => {
    const index = new LineIndex(0, { unit: 'byte' })
    index.finish(0)
    expect(index.lines).toBe(0)
    expect(index.complete).toBe(true)
    expect(index.checkpointFor(0)).toEqual({ line: 0, offset: 0 })
  })

  it('逐字节喂入与整块喂入结果相同', () => {
    const bytes = utf8('一\r\n二\n\n三\r\n')
    for (const chunkSize of [1, 2, 3, 5, 64]) {
      expect(buildIndex(bytes, { unit: 'byte' }, { chunkSize }).lines).toBe(4)
    }
  })
})

describe('LineIndex：UTF-16', () => {
  // U+0A0A、U+010A 的某个字节是 0x0A；U+0A41 + U+4100（LE：41 0A 00 41）、
  // U+0100 + U+0A41（BE：01 00 0A 41）在非对齐位置出现换行单元的字节序列。都不应切行
  const tricky = 'x\u0a00\u0a0a\u010a\u0a41\u4100\u0100\u0a41y'
  const text = `${tricky}\r\n${tricky}\nend`

  for (const endian of ['le', 'be'] as const) {
    const unit = endian === 'le' ? 'utf16le' : 'utf16be'
    it(`${unit}：只按对齐的 0x000A 单元切行（任意分块）`, () => {
      const bytes = utf16(text, endian)
      for (const chunkSize of [1, 2, 3, 4, 5, 7, 1024]) {
        const index = buildIndex(bytes, { unit }, { chunkSize, finish: false })
        expect(index.lines, `chunkSize=${chunkSize}`).toBe(2)
        index.finish(bytes.length)
        expect(index.lines).toBe(3)
      }
    })

    it(`${unit}：窗口起点为奇数时按窗口内的对齐判断`, () => {
      const bytes = utf16(text, endian)
      const index = buildIndex(bytes, { unit }, { chunkSize: 3, windowStart: 101 })
      expect(index.lines).toBe(3)
    })

    it(`${unit}：超过 2^32 的偏移也按奇偶正确对齐`, () => {
      const bytes = utf16(text, endian)
      const windowStart = 2 ** 32 + 1
      const index = buildIndex(bytes, { unit }, { chunkSize: 5, windowStart })
      expect(index.lines).toBe(3)
      expect(index.indexedTo).toBe(windowStart + bytes.length)
    })
  }
})

describe('LineIndex：检查点', () => {
  it('行号为 1000 的倍数时记录检查点', () => {
    const index = buildIndex(utf8('x\n'.repeat(2500)))
    expect(index.lines).toBe(2500)
    expect(index.checkpointFor(0)).toEqual({ line: 0, offset: 0 })
    expect(index.checkpointFor(999)).toEqual({ line: 0, offset: 0 })
    expect(index.checkpointFor(1000)).toEqual({ line: 1000, offset: 2000 })
    expect(index.checkpointFor(1999)).toEqual({ line: 1000, offset: 2000 })
    expect(index.checkpointFor(2499)).toEqual({ line: 2000, offset: 4000 })
  })

  it('一行 3MB 之后的下一行有检查点', () => {
    const long = 3 * 1024 * 1024
    const bytes = new Uint8Array(long + 3).fill(0x41)
    bytes.set(utf8('\nb\n'), long)
    const index = buildIndex(bytes)
    expect(index.lines).toBe(2)
    expect(index.checkpointFor(1)).toEqual({ line: 1, offset: long + 1 })
  })

  it('距上一个检查点超过 checkpointBytes 时记录（可配置）', () => {
    // 每行 10 字节；checkpointBytes = 25 → 行首偏移 30、60、90 处各有检查点
    const index = buildIndex(utf8('123456789\n'.repeat(10)), {
      unit: 'byte',
      checkpointBytes: 25,
      checkpointLines: 1000
    })
    expect(index.checkpointFor(2)).toEqual({ line: 0, offset: 0 })
    expect(index.checkpointFor(3)).toEqual({ line: 3, offset: 30 })
    expect(index.checkpointFor(5)).toEqual({ line: 3, offset: 30 })
    expect(index.checkpointFor(6)).toEqual({ line: 6, offset: 60 })
  })

  it('窗口起点非 0：检查点为文件中的绝对偏移', () => {
    const index = buildIndex(
      utf8('ab\n'.repeat(5)),
      { unit: 'byte', checkpointLines: 2 },
      {
        windowStart: 100
      }
    )
    expect(index.checkpointFor(0)).toEqual({ line: 0, offset: 100 })
    expect(index.checkpointFor(3)).toEqual({ line: 2, offset: 106 })
    expect(index.indexedTo).toBe(115)
  })
})

describe('LineIndex：增量与约束', () => {
  it('reopen 后追加使末行延长而非新增', () => {
    const index = buildIndex(utf8('a\nbc'))
    expect(index.lines).toBe(2)
    index.reopen()
    expect(index.complete).toBe(false)
    expect(index.lines).toBe(1)
    index.feed(utf8('d\ne'), 4)
    expect(index.lines).toBe(2)
    index.finish(7)
    expect(index.lines).toBe(3)
  })

  it('末行已有换行时 reopen 不改变行数', () => {
    const index = buildIndex(utf8('a\n'))
    index.reopen()
    expect(index.lines).toBe(1)
    index.feed(utf8('b'), 2)
    index.finish(3)
    expect(index.lines).toBe(2)
  })

  it('offset 必须等于 indexedTo', () => {
    const index = new LineIndex(10, { unit: 'byte' })
    expect(() => index.feed(utf8('a'), 0)).toThrow(RangeError)
    index.feed(utf8('a'), 10)
    expect(() => index.feed(utf8('b'), 12)).toThrow(RangeError)
  })

  it('finish 后不能 feed；finish 的终点必须等于 indexedTo', () => {
    const index = new LineIndex(0, { unit: 'byte' })
    index.feed(utf8('ab'), 0)
    expect(() => index.finish(3)).toThrow(RangeError)
    index.finish(2)
    expect(() => index.feed(utf8('c'), 2)).toThrow(Error)
  })

  it('checkpointFor 的行号越界时抛出', () => {
    const index = buildIndex(utf8('a\n'))
    expect(() => index.checkpointFor(-1)).toThrow(RangeError)
  })
})
