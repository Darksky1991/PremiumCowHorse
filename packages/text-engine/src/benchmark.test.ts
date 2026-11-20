// 索引吞吐与按行读取的基准（设计第 5 节：全量索引 ≥ 300MB/s）。
// 数据在内存中生成、不入库；只在 PCH_BENCH=1 时运行：PCH_BENCH=1 pnpm vitest run packages/text-engine
import { describe, expect, it } from 'vitest'
import { LineIndex } from './line-index'
import { readLines } from './line-reader'
import type { NewlineUnit } from './types'
import { memoryReadAt, utf16, utf8 } from './test-utils'

const MB = 1024 * 1024
const TOTAL = 200 * MB
const CHUNK = 4 * MB

/** 生成 CHUNK 字节的日志样数据（行长约 60–220 字节，CRLF；截断处的半行与下一块相接） */
function sampleChunk(unit: NewlineUnit): Uint8Array {
  const lines: string[] = []
  for (let i = 0, chars = 0; chars < CHUNK; i++) {
    const line = `2026-11-20 12:34:56.${String(i % 1000).padStart(3, '0')} INFO [worker-${i % 16}] ${'処理'.repeat(i % 7)}${'x'.repeat(20 + ((i * 37) % 140))}\r\n`
    lines.push(line)
    chars += line.length
  }
  const text = lines.join('')
  const bytes = unit === 'byte' ? utf8(text) : utf16(text, unit === 'utf16le' ? 'le' : 'be')
  return bytes.subarray(0, CHUNK)
}

describe.skipIf(process.env.PCH_BENCH !== '1')('基准（PCH_BENCH=1）', () => {
  for (const unit of ['byte', 'utf16le'] as const) {
    it(`索引吞吐：${unit}，200MB`, () => {
      const chunk = sampleChunk(unit)
      const index = new LineIndex(0, { unit })
      const t0 = performance.now()
      for (let offset = 0; offset < TOTAL; offset += chunk.length) index.feed(chunk, offset)
      index.finish(index.indexedTo)
      const ms = performance.now() - t0
      const mbps = index.indexedTo / MB / (ms / 1000)
      console.log(
        `[bench] index ${unit}: ${(index.indexedTo / MB).toFixed(0)}MB, ${index.lines} lines, ${ms.toFixed(0)}ms, ${mbps.toFixed(0)}MB/s`
      )
      expect(index.lines).toBeGreaterThan(0)
    }, 120_000)
  }

  it('随机跳转：200MB 中读取 100 次 × 100 行', async () => {
    const chunk = sampleChunk('byte')
    const file = new Uint8Array(Math.floor(TOTAL / chunk.length) * chunk.length)
    for (let o = 0; o < file.length; o += chunk.length) file.set(chunk, o)
    const index = new LineIndex(0, { unit: 'byte' })
    index.feed(file, 0)
    index.finish(file.length)
    const { readAt, stats } = memoryReadAt(file)
    const t0 = performance.now()
    for (let i = 0; i < 100; i++) {
      const start = Math.floor((((i * 7919) % 100) / 100) * (index.lines - 100))
      const block = await readLines(index, readAt, start, 100)
      expect(block.starts.length).toBe(100)
    }
    const ms = performance.now() - t0
    console.log(
      `[bench] readLines: 100 jumps, ${(ms / 100).toFixed(2)}ms/jump, ${(stats.bytes / 100 / 1024).toFixed(0)}KB read/jump`
    )
  }, 120_000)
})
