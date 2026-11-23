import { describe, expect, it } from 'vitest'
import { filterInputReducer, type FilterInput } from './use-filter-input'

const empty: FilterInput = { text: '', query: '' }

describe('filterInputReducer', () => {
  it('filters on every change outside IME composition', () => {
    const s = filterInputReducer(empty, { type: 'change', value: 'ab', composing: false })
    expect(s).toEqual({ text: 'ab', query: 'ab' })
  })

  it('only updates the text while composing, and filters on compositionend', () => {
    let s = filterInputReducer(empty, { type: 'change', value: 'ば', composing: true })
    expect(s).toEqual({ text: 'ば', query: '' })
    s = filterInputReducer(s, { type: 'change', value: 'ばっち', composing: true })
    expect(s).toEqual({ text: 'ばっち', query: '' })
    s = filterInputReducer(s, { type: 'compositionEnd', value: 'バッチ' })
    expect(s).toEqual({ text: 'バッチ', query: 'バッチ' })
    // Chromium 在 compositionend 之后可能再发一次非组字的 input：结果不变
    expect(filterInputReducer(s, { type: 'change', value: 'バッチ', composing: false })).toEqual(s)
  })

  it('keeps the previous query while a new composition starts on top of it', () => {
    const s = filterInputReducer(
      { text: 'ab', query: 'ab' },
      {
        type: 'change',
        value: 'abか',
        composing: true
      }
    )
    expect(s).toEqual({ text: 'abか', query: 'ab' })
  })

  it('clears both', () => {
    expect(filterInputReducer({ text: 'x', query: 'x' }, { type: 'clear' })).toEqual(empty)
  })
})
