import { describe, expect, expectTypeOf, it, vi } from 'vitest'
import {
  DOC_ENCODINGS,
  DOC_READ_LINES_MAX,
  ipcContract,
  type DocEncoding,
  type DocLineBlock
} from '@pch/shared'
import { ENCODING_LABELS, type EncodingLabel, type LineBlock } from '@pch/text-engine'
import { documentHandlers, type DocumentApi } from './document.ipc'

describe('shared doc types and @pch/text-engine stay identical', () => {
  it('DOC_ENCODINGS is the same set as ENCODING_LABELS', () => {
    expectTypeOf<DocEncoding>().toEqualTypeOf<EncodingLabel>()
    expect([...DOC_ENCODINGS.options].sort()).toEqual([...ENCODING_LABELS].sort())
  })

  it('DocLineBlock has the same shape as LineBlock', () => {
    expectTypeOf<DocLineBlock>().toEqualTypeOf<LineBlock>()
  })
})

describe('doc.* input validation (contract)', () => {
  const lines = ipcContract['doc.readLines'].input
  it('accepts 1..2000 lines and rejects counts outside it', () => {
    expect(DOC_READ_LINES_MAX).toBe(2000)
    expect(lines.safeParse({ docId: 'd', start: 0, count: 2000 }).success).toBe(true)
    expect(lines.safeParse({ docId: 'd', start: 0, count: 2001 }).success).toBe(false)
    expect(lines.safeParse({ docId: 'd', start: 0, count: 0 }).success).toBe(false)
    expect(lines.safeParse({ docId: 'd', start: 0, count: 1.5 }).success).toBe(false)
    expect(lines.safeParse({ docId: 'd', start: -1, count: 1 }).success).toBe(false)
  })

  it('accepts only known encodings and positions', () => {
    const open = ipcContract['doc.open'].input
    expect(
      open.safeParse({ uri: 'file:///C:/a.log', encoding: 'shift_jis', at: 'end' }).success
    ).toBe(true)
    expect(open.safeParse({ uri: 'file:///C:/a.log', encoding: 'sjis' }).success).toBe(false)
    expect(open.safeParse({ uri: 'file:///C:/a.log', at: 'middle' }).success).toBe(false)
    const set = ipcContract['doc.setEncoding'].input
    expect(set.safeParse({ docId: 'd', encoding: null }).success).toBe(true)
    expect(set.safeParse({ docId: 'd' }).success).toBe(false)
  })
})

describe('documentHandlers', () => {
  it('passes the calling window as the owner', async () => {
    const docs = {
      open: vi.fn(async () => 'info'),
      readLines: vi.fn(async () => 'block'),
      refresh: vi.fn(async () => 'info'),
      setEncoding: vi.fn(async () => 'info'),
      buildIndex: vi.fn(async () => 'info'),
      close: vi.fn()
    }
    const handlers = documentHandlers(docs as unknown as DocumentApi)
    const ctx = { senderId: 9 }
    await handlers['doc.open']({ uri: 'file:///C:/a.log', at: 'end' }, ctx)
    await handlers['doc.readLines']({ docId: 'd', start: 5, count: 10 }, ctx)
    await handlers['doc.refresh']({ docId: 'd' }, ctx)
    await handlers['doc.setEncoding']({ docId: 'd', encoding: null }, ctx)
    await handlers['doc.buildIndex']({ docId: 'd' }, ctx)
    await handlers['doc.close']({ docId: 'd' }, ctx)
    expect(docs.open).toHaveBeenCalledWith(9, { uri: 'file:///C:/a.log', at: 'end' })
    expect(docs.readLines).toHaveBeenCalledWith(9, 'd', 5, 10)
    expect(docs.refresh).toHaveBeenCalledWith(9, 'd')
    expect(docs.setEncoding).toHaveBeenCalledWith(9, 'd', null)
    expect(docs.buildIndex).toHaveBeenCalledWith(9, 'd')
    expect(docs.close).toHaveBeenCalledWith(9, 'd')
  })
})
