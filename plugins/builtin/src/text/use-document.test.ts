import { describe, expect, it } from 'vitest'
import type { DocumentInfo } from '@pch/plugin-sdk'
import { applyChange, type DocumentState } from './use-document'

const info = (extra: Partial<DocumentInfo> = {}): DocumentInfo => ({
  docId: 'doc-1',
  uri: 'file:///C:/logs/app.log',
  size: 10,
  mtime: 1,
  encoding: { label: 'utf-8', confidence: 'likely', bomLength: 0, manual: false },
  binary: false,
  mode: 'full',
  window: { start: 0, end: 10 },
  index: { lines: 2, complete: true, indexedTo: 10 },
  ...extra
})

const state = (extra: Partial<DocumentState> = {}): DocumentState => ({
  info: info(),
  error: null,
  missing: false,
  indexError: null,
  epoch: 3,
  awaitingInfo: false,
  ...extra
})

describe('applyChange', () => {
  it('a reset without info drops the lines at once (epoch) and waits for the info', () => {
    const s = state({ missing: true })
    const next = applyChange(s, { docId: 'doc-1', reset: true })
    expect(next).toEqual({ ...s, missing: false, epoch: 4, awaitingInfo: true })
  })

  it('the info that follows replaces the old one and ends the wait', () => {
    const rotated = info({ size: 3 })
    const next = applyChange(state({ epoch: 4, awaitingInfo: true }), {
      docId: 'doc-1',
      reset: true,
      info: rotated
    })
    expect(next).toMatchObject({ info: rotated, awaitingInfo: false, missing: false })
  })

  it('appended / missing with info', () => {
    const grown = info({ size: 20 })
    expect(applyChange(state(), { docId: 'doc-1', appended: true, info: grown })).toEqual(
      state({ info: grown })
    )
    expect(applyChange(state(), { docId: 'doc-1', missing: true, info: info() })).toEqual(
      state({ missing: true })
    )
  })

  it('ignores changes of another document', () => {
    const s = state()
    expect(applyChange(s, { docId: 'doc-2', reset: true })).toBe(s)
  })
})
