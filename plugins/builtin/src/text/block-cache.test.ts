import { describe, expect, it } from 'vitest'
import { BlockCache, LINE_OVERHEAD, type CachedLine } from './block-cache'

const line = (text: string): CachedLine => ({ text, truncated: false, replaced: false })
const lines = (start: number, count: number, width = 1): CachedLine[] =>
  Array.from({ length: count }, (_, i) => line(String(start + i).padEnd(width, '.')))
/** count 行、共 chars 个字符占用的额度（每行另加固定开销） */
const cost = (chars: number, count: number): number => chars + count * LINE_OVERHEAD

describe('BlockCache', () => {
  it('stores and returns lines by line number across blocks', () => {
    const cache = new BlockCache({ maxChars: 1_000_000, blockLines: 10 })
    cache.put(5, lines(5, 10), cache.stamp())
    expect(cache.get(4)).toBeUndefined()
    expect(cache.get(5)?.text).toBe('5')
    expect(cache.get(9)?.text).toBe('9')
    expect(cache.get(10)?.text).toBe('10')
    expect(cache.get(14)?.text).toBe('14')
    expect(cache.get(15)).toBeUndefined()
  })

  it('plans one request per block from the first missing line to the end of the block (capped by total)', () => {
    const cache = new BlockCache({ maxChars: 1_000_000, blockLines: 10 })
    expect(cache.missing(3, 25, 22)).toEqual([
      { block: 0, start: 3, count: 7 },
      { block: 1, start: 10, count: 10 },
      { block: 2, start: 20, count: 2 }
    ])
    cache.put(10, lines(10, 4), cache.stamp())
    cache.put(16, lines(16, 4), cache.stamp())
    // 第 1 块已有 10–13、16–19：从第一个缺的行（14）起到块尾
    expect(cache.missing(10, 20, 100)).toEqual([{ block: 1, start: 14, count: 6 }])
    expect(cache.missing(16, 20, 100)).toEqual([])
    expect(cache.missing(0, 0, 100)).toEqual([])
  })

  it('evicts the least recently used blocks over the character limit', () => {
    // 每块 10 行 × 10 字符（+ 每行开销）；上限为 2.5 块 → 最多 2 块
    const block = cost(100, 10)
    const cache = new BlockCache({ maxChars: 2.5 * block, blockLines: 10 })
    cache.put(0, lines(0, 10, 10), cache.stamp())
    cache.put(10, lines(10, 10, 10), cache.stamp())
    expect(cache.chars).toBe(2 * block)
    cache.get(3) // 第 0 块变为最近使用
    cache.put(20, lines(20, 10, 10), cache.stamp())
    expect(cache.get(3)).toBeDefined()
    expect(cache.get(13)).toBeUndefined()
    expect(cache.get(23)).toBeDefined()
    expect(cache.chars).toBe(2 * block)
  })

  it('keeps the block just written even when it alone exceeds the limit', () => {
    const cache = new BlockCache({ maxChars: 5, blockLines: 10 })
    cache.put(0, lines(0, 3, 10), cache.stamp())
    expect(cache.get(2)?.text).toBe('2.........')
    cache.put(10, lines(10, 1, 10), cache.stamp())
    expect(cache.get(2)).toBeUndefined()
    expect(cache.get(10)).toBeDefined()
    expect(cache.chars).toBe(cost(10, 1))
  })

  it('replacing a line updates the character count', () => {
    const cache = new BlockCache({ maxChars: 1000, blockLines: 10 })
    cache.put(0, [line('abc')], cache.stamp())
    cache.put(0, [line('abcdef')], cache.stamp())
    expect(cache.chars).toBe(cost(6, 1))
  })

  it('counts a fixed overhead per line, so many empty lines are bounded too', () => {
    // 上限 = 1000 个空行的开销：每块 1000 行，写入第二块时淘汰第一块
    const cache = new BlockCache({ maxChars: 1000 * LINE_OVERHEAD, blockLines: 1000 })
    for (let b = 0; b < 10; b++) {
      cache.put(
        b * 1000,
        Array.from({ length: 1000 }, () => line('')),
        cache.stamp()
      )
    }
    expect(cache.chars).toBe(cost(0, 1000))
    expect(cache.get(9500)).toBeDefined()
    expect(cache.get(8500)).toBeUndefined()
    expect(cache.get(0)).toBeUndefined()
  })

  it('dropFrom forgets the line that may have grown (appended) and everything after it', () => {
    const cache = new BlockCache({ maxChars: 1000, blockLines: 10 })
    cache.put(0, lines(0, 15), cache.stamp())
    cache.dropFrom(9)
    expect(cache.get(8)).toBeDefined()
    expect(cache.get(9)).toBeUndefined()
    expect(cache.get(14)).toBeUndefined()
    expect(cache.chars).toBe(cost(9, 9))
  })

  it('ignores lines at or after a drop point that happened while the request was in flight', () => {
    const cache = new BlockCache({ maxChars: 1000, blockLines: 10 })
    const stamp = cache.stamp()
    cache.dropFrom(12)
    cache.put(8, lines(8, 6), stamp)
    expect(cache.get(11)?.text).toBe('11')
    expect(cache.get(12)).toBeUndefined()
    expect(cache.get(13)).toBeUndefined()
    // 之后发出的请求不受影响
    cache.put(12, lines(12, 2), cache.stamp())
    expect(cache.get(13)?.text).toBe('13')
  })

  it('clear empties everything', () => {
    const cache = new BlockCache({ maxChars: 1000, blockLines: 10 })
    cache.put(0, lines(0, 5), cache.stamp())
    cache.clear()
    expect(cache.get(0)).toBeUndefined()
    expect(cache.chars).toBe(0)
  })
})
