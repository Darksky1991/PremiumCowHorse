import { afterAll, describe, expect, it } from 'vitest'
import { detectEncoding, sampleRanges, SAMPLE_BYTES } from './encoding'
import { loadFixtures, type Fixture } from './fixtures.test-helper'
import type { EncodingLabel } from './types'
import { utf16, utf8 } from './test-utils'

const fixtures = loadFixtures()

/** 按 sampleRanges 从整份数据中取样（主进程按同样的范围读文件） */
const takeSamples = (bytes: Uint8Array): Uint8Array[] =>
  sampleRanges(bytes.length).map(({ offset, length }) => bytes.subarray(offset, offset + length))

const concat = (parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

/** 样本按 LF 切成行（保留 LF），只取含非 ASCII 字节的行 */
function nonAsciiLines(bytes: Uint8Array): Uint8Array[] {
  const lines: Uint8Array[] = []
  let start = 0
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] !== 0x0a) continue
    const line = bytes.subarray(start, i + 1)
    if (line.some((b) => b >= 0x80)) lines.push(line)
    start = i + 1
  }
  return lines
}

const fixture = (file: string): Fixture => {
  const f = fixtures.find((x) => x.entry.file === file)
  if (!f) throw new Error(`no fixture ${file}`)
  return f
}

// ---- 准确率汇总（打印到测试输出，便于记录） ----
const results: { f: Fixture; label: EncodingLabel; confidence: string; ok: boolean }[] = []
afterAll(() => {
  const groups = new Map<string, { ok: number; total: number }>()
  for (const r of results) {
    const key = `${r.f.entry.lang} × ${r.f.entry.label}${r.f.entry.ambiguous ? '（ambiguous）' : ''}`
    const g = groups.get(key) ?? { ok: 0, total: 0 }
    g.total++
    if (r.ok) g.ok++
    groups.set(key, g)
  }
  const ok = results.filter((r) => r.ok).length
  const lines = [...groups].map(([k, g]) => `  ${k}: ${g.ok}/${g.total}`)
  const failures = results
    .filter((r) => !r.ok)
    .map(
      (r) =>
        `  ✗ ${r.f.entry.file}: ${r.label} (${r.confidence})，期望 ${r.f.entry.ambiguous ? "confidence 'guess'" : r.f.entry.acceptable.join(' / ')}`
    )
  console.log([`编码判断准确率：${ok}/${results.length}`, ...lines, ...failures].join('\n'))
})

describe('detectEncoding：样本集', () => {
  it.each(fixtures.map((f) => [f.entry.file, f] as const))('%s', (_, f) => {
    const guess = detectEncoding(takeSamples(f.bytes))
    const ok = f.entry.ambiguous
      ? guess.confidence === 'guess'
      : f.entry.acceptable.includes(guess.label)
    results.push({ f, label: guess.label, confidence: guess.confidence, ok })
    if (f.entry.ambiguous) {
      expect(guess.confidence).toBe('guess')
    } else {
      expect(f.entry.acceptable).toContain(guess.label)
    }
  })

  it('BOM → certain，bomLength 为 BOM 字节数；无 BOM → 0', () => {
    for (const f of fixtures) {
      const guess = detectEncoding([f.bytes])
      const b = f.bytes
      const bom =
        b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf
          ? 3
          : (b[0] === 0xff && b[1] === 0xfe) || (b[0] === 0xfe && b[1] === 0xff)
            ? 2
            : 0
      expect(guess.bomLength, f.entry.file).toBe(bom)
      if (bom > 0) expect(guess.confidence, f.entry.file).toBe('certain')
      else expect(guess.confidence, f.entry.file).not.toBe('certain')
    }
  })
})

describe('detectEncoding：前置判断', () => {
  it('空样本 / 没有样本 → utf-8', () => {
    expect(detectEncoding([]).label).toBe('utf-8')
    expect(detectEncoding([new Uint8Array(0)]).label).toBe('utf-8')
  })

  it('无 BOM 的 UTF-16（含 ASCII）→ likely', () => {
    expect(detectEncoding([utf16('INFO 起動しました\r\n', 'le')])).toEqual({
      label: 'utf-16le',
      confidence: 'likely',
      bomLength: 0
    })
    expect(detectEncoding([utf16('INFO started\r\n', 'be')]).label).toBe('utf-16be')
  })

  it('纯 ASCII 不会被当作「码点集中在 CJK 区」的 UTF-16', () => {
    // 'ex', 'am' 等按 UTF-16LE 读是 U+7865 等 CJK 码点
    expect(detectEncoding([utf8('examplevaluesforthetest')]).label).toBe('utf-8')
  })

  it('ISO-2022-JP 转义序列 → iso-2022-jp；只有 ESC ( B 不算', () => {
    expect(detectEncoding([utf8('abc \x1b$B$3$s$K$A$O\x1b(B def\n')]).label).toBe('iso-2022-jp')
    expect(detectEncoding([utf8('abc \x1b(B def\n')]).label).toBe('utf-8')
  })

  it('严格 UTF-8：容忍样本末尾被截断的多字节字符', () => {
    const text = utf8('ログを出力しました')
    const guess = detectEncoding([text.subarray(0, text.length - 1)])
    expect(guess.label).toBe('utf-8')
  })

  it('没有任何编码说得通 → utf-8 guess（宽松解码）', () => {
    // 0x81 0x8D 0x8F 在 windows-1252 中是未定义的 C1 控制字符，CJK 编码下也不合法
    expect(detectEncoding([Uint8Array.from([0x41, 0x8d, 0x0a, 0x8f, 0x0a, 0x81, 0x0a])])).toEqual({
      label: 'utf-8',
      confidence: 'guess',
      bomLength: 0
    })
  })
})

/** windows-1252 编码（只覆盖测试用到的非 ASCII 字符） */
function cp1252(text: string): Uint8Array {
  const table: Record<string, number> = { é: 0xe9, '“': 0x93, '”': 0x94, '’': 0x92, ü: 0xfc }
  return Uint8Array.from([...text].map((ch) => table[ch] ?? ch.charCodeAt(0)))
}

describe('detectEncoding：windows-1252 短英文不被当作无 BOM 的纯中日文 UTF-16', () => {
  // 回归（审查第 1 轮）：小写字母两两组成的 UTF-16 单元落在 U+4E00–9FFF，曾被判成 utf-16le / be（likely）
  it.each(['report résumé meeting', 'and “draft” fine'])('%s', (text) => {
    expect(detectEncoding([cp1252(text)]).label).toBe('windows-1252')
  })
})

describe('detectEncoding：preferred', () => {
  // B0A1 B0A2：EUC-JP「亜唖」、GBK「啊阿」、Big5「陛陝」，都是各自的常用字区，得分相同
  const tie = Uint8Array.from([0xb0, 0xa1, 0xb0, 0xa2])

  it('平局时按 preferred 排序，且为 guess', () => {
    const zh = detectEncoding([tie], { preferred: 'zh-CN' })
    expect(zh).toEqual({ label: 'gb18030', confidence: 'guess', bomLength: 0 })
    const ja = detectEncoding([tie], { preferred: 'ja' })
    expect(['euc-jp', 'shift_jis']).toContain(ja.label)
    expect(ja.confidence).toBe('guess')
  })

  it('不指定 preferred 时日文编码优先（对日运维）', () => {
    expect(['euc-jp', 'shift_jis']).toContain(detectEncoding([tie]).label)
  })
})

describe('detectEncoding：开头 / 中间 / 末尾各 64KB 抽样', () => {
  const ascii = (n: number, tag: string): Uint8Array =>
    concat(
      Array.from({ length: n }, (_, i) =>
        utf8(`2026-11-20 10:${String(i % 60).padStart(2, '0')}:00 INFO [${tag}] job ${i} ok\r\n`)
      )
    )
  /**
   * 约 300KB 的 ASCII 日志，把样本中的少量非 ASCII 行（每行之间隔 40 行 ASCII）插在
   * 文件中点（落在中间样本内）和 / 或末尾附近（落在末尾样本内）
   */
  function sparseLog(file: string, where: 'middle' | 'tail' | 'both'): Uint8Array {
    const special = nonAsciiLines(fixture(file).bytes).slice(0, 6)
    expect(special.length).toBeGreaterThan(2)
    const sprinkle = (tag: string): Uint8Array =>
      concat(special.flatMap((line) => [ascii(40, tag), line]))
    const filler = ascii(6400, 'body') // 约 300KB
    const half = filler.indexOf(0x0a, filler.length / 2 - 8 * 1024) + 1 // 中点前约 8KB 的行首
    return concat([
      filler.subarray(0, half),
      where === 'tail' ? new Uint8Array(0) : sprinkle('mid'),
      filler.subarray(half),
      where === 'middle' ? new Uint8Array(0) : sprinkle('tail'),
      ascii(20, 'end')
    ])
  }
  const isAscii = (bytes: Uint8Array): boolean => bytes.every((b) => b < 0x80)

  it.each([
    ['ja-sjis-log.txt', 'middle', 'shift_jis'],
    ['ja-sjis-hw-log.txt', 'tail', 'shift_jis'],
    ['zh-gbk-log.txt', 'tail', 'gb18030'],
    ['ja-eucjp-log.txt', 'both', 'euc-jp'],
    ['tw-big5-log.txt', 'middle', 'big5'],
    ['en-1252-log.txt', 'tail', 'windows-1252']
  ] as const)('%s 的非 ASCII 行在 %s', (file, where, label) => {
    const log = sparseLog(file, where)
    expect(log.length).toBeGreaterThan(200 * 1024)
    const samples = takeSamples(log)
    expect(samples).toHaveLength(3)
    const [head, middle, tail] = samples as [Uint8Array, Uint8Array, Uint8Array]
    // 开头 64KB 全是 ASCII：只看开头会判成 UTF-8
    expect(isAscii(head)).toBe(true)
    expect(detectEncoding([head]).label).toBe('utf-8')
    // 非 ASCII 确实只落在指定的样本里
    expect(isAscii(middle)).toBe(where === 'tail')
    expect(isAscii(tail)).toBe(where === 'middle')
    expect(detectEncoding(samples).label).toBe(label)
  })

  it('中间样本从多字节字符的中间开始也能判对（对齐到下一行行首）', () => {
    const [line] = nonAsciiLines(fixture('ja-sjis-log.txt').bytes)
    if (!line) throw new Error('no non-ASCII line')
    const highAt = line.findIndex((b) => b >= 0x80)
    // 中间样本从一个双字节字符的第 2 字节开始
    const middle = concat([line.subarray(highAt + 1), ascii(5, 'x'), line, line])
    expect(detectEncoding([ascii(100, 'head'), middle]).label).toBe('shift_jis')
  })
})

type Range = { offset: number; length: number }

describe('sampleRanges', () => {
  it('小于 3 个样本大小：整份一个样本', () => {
    expect(sampleRanges(0)).toEqual([])
    expect(sampleRanges(1000)).toEqual([{ offset: 0, length: 1000 }])
    expect(sampleRanges(3 * SAMPLE_BYTES)).toEqual([{ offset: 0, length: 3 * SAMPLE_BYTES }])
  })

  it('更大：开头 / 中间 / 末尾各一个，互不重叠', () => {
    const size = 10 * SAMPLE_BYTES + 1
    const ranges = sampleRanges(size)
    expect(ranges).toHaveLength(3)
    const [head, middle, tail] = ranges as [Range, Range, Range]
    expect(head).toEqual({ offset: 0, length: SAMPLE_BYTES })
    expect(tail).toEqual({ offset: size - SAMPLE_BYTES, length: SAMPLE_BYTES })
    expect(middle.length).toBe(SAMPLE_BYTES)
    expect(middle.offset).toBeGreaterThanOrEqual(SAMPLE_BYTES)
    expect(middle.offset + SAMPLE_BYTES).toBeLessThanOrEqual(size - SAMPLE_BYTES)
  })
})
