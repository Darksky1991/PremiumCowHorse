import { describe, expect, it } from 'vitest'
import { decodeBlock } from './decode'
import { loadFixtures } from './fixtures.test-helper'
import { readLines } from './line-reader'
import type { LineBlock } from './types'
import { buildIndex, memoryReadAt, utf16, utf8 } from './test-utils'

const fixtures = loadFixtures()
const fixture = (file: string): Uint8Array => {
  const f = fixtures.find((x) => x.entry.file === file)
  if (!f) throw new Error(`no fixture ${file}`)
  return f.bytes
}
const expectedLines = (file: string): string[] => {
  const f = fixtures.find((x) => x.entry.file === file)
  if (!f) throw new Error(`no fixture ${file}`)
  return f.text.replace(/^\uFEFF/, '').split(/\r?\n/)
}

async function read(
  bytes: Uint8Array,
  start: number,
  count: number,
  unit: 'byte' | 'utf16le' | 'utf16be' = 'byte',
  maxLineBytes?: number
): Promise<LineBlock> {
  const index = buildIndex(bytes, { unit })
  return readLines(index, memoryReadAt(bytes).readAt, start, count, { maxLineBytes })
}

describe('decodeBlock', () => {
  it('按行解码：\\r 已由 reader 去掉，不出现在结果中', async () => {
    const block = await read(utf8('a\r\nbb\n\nccc'), 0, 10)
    expect(decodeBlock(block, 'utf-8')).toEqual({ lines: ['a', 'bb', '', 'ccc'], replaced: false })
  })

  it('skipBytesAtStart 去掉 BOM（UTF-8 / UTF-16LE）', async () => {
    const u8 = await read(Uint8Array.from([0xef, 0xbb, 0xbf, ...utf8('ログ\r\nx\r\n')]), 0, 10)
    expect(decodeBlock(u8, 'utf-8', { skipBytesAtStart: 3 }).lines).toEqual(['ログ', 'x'])
    // 不跳过时 BOM 原样保留为 U+FEFF（不由解码器偷偷去掉）
    expect(decodeBlock(u8, 'utf-8').lines[0]).toBe('﻿ログ')

    const u16 = await read(
      Uint8Array.from([0xff, 0xfe, ...utf16('ログ\r\nx', 'le')]),
      0,
      10,
      'utf16le'
    )
    expect(decodeBlock(u16, 'utf-16le', { skipBytesAtStart: 2 }).lines).toEqual(['ログ', 'x'])
  })

  it('每行截断到 maxChars（默认 10000），不切断代理对', async () => {
    const long = await read(utf8('x'.repeat(12000) + '\n' + 'ab😀cd'), 0, 2)
    const { lines } = decodeBlock(long, 'utf-8')
    expect(lines[0]).toHaveLength(10000)
    expect(decodeBlock(long, 'utf-8', { maxChars: 3 }).lines[1]).toBe('ab')
    expect(decodeBlock(long, 'utf-8', { maxChars: 4 }).lines[1]).toBe('ab😀')
  })

  it('非法字节 → replaced', async () => {
    const block = await read(Uint8Array.from([0x61, 0xff, 0x62, 0x0a, 0x63]), 0, 2)
    expect(decodeBlock(block, 'utf-8')).toEqual({ lines: ['a�b', 'c'], replaced: true })
  })

  it('reader 截断的行在多字节字符中间结束：丢弃残缺字符，不算 replaced', async () => {
    // 「ログ」= E3 83 AD E3 82 B0；保留 5 字节时切断「グ」
    const block = await read(utf8('ログ\nok\n'), 0, 2, 'byte', 5)
    expect(block.truncated).toEqual([0])
    expect(decodeBlock(block, 'utf-8')).toEqual({ lines: ['ロ', 'ok'], replaced: false })
    // Shift_JIS：「ログ」= 83 8D 83 4F，保留 3 字节
    const sjis = await read(Uint8Array.from([0x83, 0x8d, 0x83, 0x4f, 0x0a]), 0, 1, 'byte', 3)
    expect(decodeBlock(sjis, 'shift_jis')).toEqual({ lines: ['ロ'], replaced: false })
    // UTF-16LE：切断代理对的高位
    const u16 = await read(utf16('a😀b\n', 'le'), 0, 1, 'utf16le', 4)
    expect(decodeBlock(u16, 'utf-16le')).toEqual({ lines: ['a'], replaced: false })
  })

  it('截断行中间的非法字节仍算 replaced', async () => {
    const block = await read(Uint8Array.from([0x61, 0xff, 0x62, 0x63, 0x64, 0x0a]), 0, 1, 'byte', 3)
    expect(decodeBlock(block, 'utf-8')).toEqual({ lines: ['a�b'], replaced: true })
  })

  it.each([
    ['ja-sjis-8kb.txt', 'shift_jis'],
    ['ja-eucjp-log.txt', 'euc-jp'],
    ['zh-gb18030-8kb.txt', 'gb18030'],
    ['tw-big5-log.txt', 'big5'],
    ['en-1252-log.txt', 'windows-1252'],
    ['ja-utf16le-bom-8kb.txt', 'utf-16le']
  ] as const)('%s 按 %s 解码与原文逐行一致（从中间行开始的块也一致）', async (file, label) => {
    const bytes = fixture(file)
    const unit = label === 'utf-16le' ? 'utf16le' : 'byte'
    const skip = label === 'utf-16le' ? 2 : 0
    const expected = expectedLines(file)
    const all = await read(bytes, 0, 100_000, unit)
    const decoded = decodeBlock(all, label, { skipBytesAtStart: skip })
    expect(decoded.lines).toEqual(expected.slice(0, decoded.lines.length))
    expect(decoded.lines.length).toBeGreaterThanOrEqual(expected.length - 1)
    expect(decoded.replaced).toBe(false)
    const mid = await read(bytes, 7, 20, unit)
    expect(decodeBlock(mid, label).lines).toEqual(expected.slice(7, 27))
  })

  it('ISO-2022-JP：从中间行开始的块也正确（每行以 ASCII 状态结束）', async () => {
    const bytes = fixture('ja-jis-log.txt')
    const expected = expectedLines('ja-jis-log.txt')
    const start = expected.findIndex(
      (line, i) => i > 3 && [...line].some((ch) => ch.charCodeAt(0) >= 0x80)
    )
    const block = await read(bytes, start, 5)
    expect(decodeBlock(block, 'iso-2022-jp')).toEqual({
      lines: expected.slice(start, start + 5),
      replaced: false
    })
  })
})
