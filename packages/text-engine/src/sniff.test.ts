import { describe, expect, it } from 'vitest'
import { loadFixtures } from './fixtures.test-helper'
import { sniff } from './sniff'
import { utf16, utf8 } from './test-utils'

const bytes = (...values: number[]): Uint8Array => Uint8Array.from(values)

/** 伪随机字节（固定种子），模拟压缩数据 */
function noise(length: number, seed = 1): Uint8Array {
  const out = new Uint8Array(length)
  let x = seed
  for (let i = 0; i < length; i++) {
    x = (x * 1103515245 + 12345) >>> 0
    out[i] = x >>> 24
  }
  return out
}

const concat = (...parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

describe('sniff', () => {
  it('空 → empty', () => {
    expect(sniff(new Uint8Array(0))).toEqual({ kind: 'empty', bom: null })
  })

  it('PNG / ZIP / exe 头 → binary', () => {
    const png = concat(
      bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d),
      utf8('IHDR'),
      noise(4000)
    )
    const zip = concat(bytes(0x50, 0x4b, 0x03, 0x04, 0x14, 0, 0, 0, 0x08, 0), noise(4000, 7))
    const exe = concat(
      bytes(0x4d, 0x5a, 0x90, 0, 0x03, 0, 0, 0, 0x04, 0, 0, 0, 0xff, 0xff, 0, 0),
      new Uint8Array(48),
      utf8('This program cannot be run in DOS mode.\r\r\n$'),
      new Uint8Array(200)
    )
    for (const head of [png, zip, exe]) {
      expect(sniff(head)).toEqual({ kind: 'binary', bom: null })
    }
  })

  it('没有 NUL 但控制字符很多 → binary', () => {
    const head = noise(4000, 3).map((b) => (b === 0 ? 1 : b))
    expect(sniff(head).kind).toBe('binary')
  })

  it('UTF-16 有 BOM → text，bom 为对应标签', () => {
    expect(sniff(concat(bytes(0xff, 0xfe), utf16('ログ\r\n', 'le')))).toEqual({
      kind: 'text',
      bom: 'utf-16le'
    })
    expect(sniff(concat(bytes(0xfe, 0xff), utf16('log\r\n', 'be')))).toEqual({
      kind: 'text',
      bom: 'utf-16be'
    })
    expect(sniff(concat(bytes(0xef, 0xbb, 0xbf), utf8('abc')))).toEqual({
      kind: 'text',
      bom: 'utf-8'
    })
  })

  it('UTF-16 无 BOM（含 ASCII / 纯中日文）→ text', () => {
    expect(sniff(utf16('2026-11-20 10:00:00 INFO started\r\n', 'le'))).toEqual({
      kind: 'text',
      bom: null
    })
    expect(sniff(utf16('2026-11-20 10:00:00 INFO started\r\n', 'be')).kind).toBe('text')
    expect(sniff(utf16('設定ファイルの読み込みに失敗しました', 'le')).kind).toBe('text')
  })

  it('ESC（ISO-2022-JP、ANSI 颜色）与 Ctrl-Z 不算二进制', () => {
    expect(sniff(utf8('\x1b$B$3$s$K$A$O\x1b(B\r\n\x1b[31mERROR\x1b[0m\r\n\x1a')).kind).toBe('text')
  })

  it('只看开头 8KB', () => {
    const head = concat(utf8('a'.repeat(8192)), new Uint8Array(100))
    expect(sniff(head).kind).toBe('text')
  })

  it('样本集中的每个样本都是 text', () => {
    for (const f of loadFixtures()) {
      expect(sniff(f.bytes).kind, f.entry.file).toBe('text')
    }
  })
})
