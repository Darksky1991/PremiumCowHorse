import { describe, expect, it } from 'vitest'
import { indexChange } from './index-change'

describe('indexChange', () => {
  it('nothing changed: nothing to drop or retry', () => {
    const s = { lines: 10, complete: true, indexedTo: 100 }
    expect(indexChange(s, { ...s })).toEqual({ dropFrom: null, retry: false })
  })

  it('an unterminated last line extended without a newline: only indexedTo changes, the last line is dropped', () => {
    // 追加的内容里没有换行：行数与 complete 前后相同（React 把中间状态批处理掉时就是这样）
    expect(
      indexChange(
        { lines: 10, complete: true, indexedTo: 100 },
        { lines: 10, complete: true, indexedTo: 130 }
      )
    ).toEqual({ dropFrom: 9, retry: false })
  })

  it('lines appended after a complete index: drop from the old last line and retry failed blocks', () => {
    expect(
      indexChange(
        { lines: 10, complete: true, indexedTo: 100 },
        { lines: 13, complete: true, indexedTo: 140 }
      )
    ).toEqual({ dropFrom: 9, retry: true })
    // 续扫开始（complete 变为 false）时同样丢弃
    expect(
      indexChange(
        { lines: 10, complete: true, indexedTo: 100 },
        { lines: 9, complete: false, indexedTo: 100 }
      )
    ).toEqual({ dropFrom: 9, retry: true })
  })

  it('progress of an index that was not complete: the counted lines are final, nothing is dropped', () => {
    expect(
      indexChange(
        { lines: 10, complete: false, indexedTo: 100 },
        { lines: 20, complete: false, indexedTo: 200 }
      )
    ).toEqual({ dropFrom: null, retry: true })
    expect(
      indexChange(
        { lines: 10, complete: false, indexedTo: 100 },
        { lines: 10, complete: false, indexedTo: 150 }
      )
    ).toEqual({ dropFrom: null, retry: false })
  })

  it('an empty document has no last line to drop', () => {
    expect(
      indexChange(
        { lines: 0, complete: true, indexedTo: 0 },
        { lines: 0, complete: true, indexedTo: 5 }
      )
    ).toEqual({ dropFrom: null, retry: false })
  })
})
