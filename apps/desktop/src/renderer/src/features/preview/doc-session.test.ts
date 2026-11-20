import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest'
import * as sdk from '@pch/plugin-sdk'
import {
  AppError,
  type DocChangedEvent,
  type DocEncoding,
  type DocLineBlock,
  type DocProgressEvent,
  type DocumentInfo,
  type IpcChannel
} from '@pch/shared'
import type { Invoke } from '@renderer/data/vfs'
import { createDocSession, type DocSession } from './doc-session'

const LOCAL = 'file:///C:/logs/app.log'
const UNC = 'file://server/share/logs/app.log'

const info = (docId: string, uri: string, extra: Partial<DocumentInfo> = {}): DocumentInfo => ({
  docId,
  uri,
  size: 10,
  mtime: 1,
  encoding: { label: 'utf-8', confidence: 'likely', bomLength: 0, manual: false },
  binary: false,
  mode: 'full',
  window: { start: 0, end: 10 },
  index: { lines: 2, complete: true, indexedTo: 10 },
  ...extra
})

const block = (start: number): DocLineBlock => ({
  start,
  bytes: new Uint8Array([0x61, 0x0a]),
  starts: [0],
  ends: [1],
  truncated: []
})

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
}
const deferred = <T>(): Deferred<T> => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

function setup(): {
  session: DocSession
  calls: Array<[IpcChannel, Record<string, unknown>]>
  /** 下一次该通道的调用由测试控制何时返回 */
  hold: (channel: IpcChannel) => Deferred<unknown>
  emitChanged: (e: DocChangedEvent) => void
  emitProgress: (e: DocProgressEvent) => void
  refresh: () => void
  /** 主进程中该文档 refresh 的返回值 */
  infos: Map<string, DocumentInfo>
  refreshFails: Map<string, AppError>
} {
  const calls: Array<[IpcChannel, Record<string, unknown>]> = []
  const held = new Map<IpcChannel, Deferred<unknown>>()
  const infos = new Map<string, DocumentInfo>()
  const refreshFails = new Map<string, AppError>()
  let seq = 0
  const invoke = (async (channel: IpcChannel, input: Record<string, unknown>) => {
    calls.push([channel, input])
    const h = held.get(channel)
    if (h) {
      held.delete(channel)
      return h.promise
    }
    switch (channel) {
      case 'doc.open': {
        const i = info(`doc-${++seq}`, input['uri'] as string)
        infos.set(i.docId, i)
        return i
      }
      case 'doc.refresh': {
        const fail = refreshFails.get(input['docId'] as string)
        if (fail) throw fail
        return infos.get(input['docId'] as string)
      }
      case 'doc.readLines':
        return block(input['start'] as number)
      case 'doc.setEncoding':
      case 'doc.buildIndex':
        return infos.get(input['docId'] as string)
      default:
        return undefined
    }
  }) as unknown as Invoke
  const changed = new Set<(e: DocChangedEvent) => void>()
  const progress = new Set<(e: DocProgressEvent) => void>()
  const refreshes = new Set<() => void>()
  const session = createDocSession({
    invoke,
    events: {
      onChanged: (l) => {
        changed.add(l)
        return () => changed.delete(l)
      },
      onProgress: (l) => {
        progress.add(l)
        return () => progress.delete(l)
      }
    },
    onRefresh: (l) => {
      refreshes.add(l)
      return () => refreshes.delete(l)
    }
  })
  session.setIntervals({ localMs: 5000, networkMs: 10_000 })
  return {
    session,
    calls,
    hold: (channel) => {
      const d = deferred<unknown>()
      held.set(channel, d)
      return d
    },
    emitChanged: (e) => changed.forEach((l) => l(e)),
    emitProgress: (e) => progress.forEach((l) => l(e)),
    refresh: () => refreshes.forEach((l) => l()),
    infos,
    refreshFails
  }
}

const refreshCalls = (calls: Array<[IpcChannel, Record<string, unknown>]>): unknown[] =>
  calls.filter(([c]) => c === 'doc.refresh').map(([, i]) => i['docId'])

/** 让排队的微任务（invoke 的应答）完成 */
const settle = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await Promise.resolve()
}

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('plugin-sdk doc types match @pch/shared', () => {
  it('has the same shapes', () => {
    expectTypeOf<sdk.DocumentInfo>().toEqualTypeOf<DocumentInfo>()
    expectTypeOf<sdk.DocLineBlock>().toEqualTypeOf<DocLineBlock>()
    expectTypeOf<sdk.DocProgress>().toEqualTypeOf<DocProgressEvent>()
    expectTypeOf<sdk.DocEncoding>().toEqualTypeOf<DocEncoding>()
    expectTypeOf<Omit<sdk.DocChange, 'info'>>().toEqualTypeOf<DocChangedEvent>()
  })
})

describe('createDocSession: open / readLines / close', () => {
  it('opens with the given options and reads lines', async () => {
    const { session, calls } = setup()
    const opened = await session.open(LOCAL, { at: 'end', encoding: 'shift_jis' })
    expect(calls[0]).toEqual(['doc.open', { uri: LOCAL, at: 'end', encoding: 'shift_jis' }])
    await expect(session.readLines(opened.docId, 3, 10)).resolves.toEqual(block(3))
    expect(calls[1]).toEqual(['doc.readLines', { docId: opened.docId, start: 3, count: 10 }])
  })

  it('omits options that were not given', async () => {
    const { session, calls } = setup()
    await session.open(LOCAL)
    expect(calls[0]).toEqual(['doc.open', { uri: LOCAL }])
  })

  it('relays progress of its own document only, until unsubscribed', async () => {
    const { session, emitProgress } = setup()
    const { docId } = await session.open(LOCAL)
    const cb = vi.fn()
    const off = session.onProgress(docId, cb)
    const event = { docId, indexedTo: 5, lines: 1, complete: false }
    emitProgress(event)
    emitProgress({ ...event, docId: 'other' })
    expect(cb).toHaveBeenCalledTimes(1)
    expect(cb).toHaveBeenCalledWith(event)
    off()
    emitProgress(event)
    expect(cb).toHaveBeenCalledTimes(1)
  })

  it('close tells the main process, stops polling and callbacks', async () => {
    const { session, calls, emitProgress } = setup()
    session.setActive(true)
    const { docId } = await session.open(LOCAL)
    const cb = vi.fn()
    session.onProgress(docId, cb)
    session.close(docId)
    expect(calls).toContainEqual(['doc.close', { docId }])
    emitProgress({ docId, indexedTo: 5, lines: 1, complete: true })
    await vi.advanceTimersByTimeAsync(20_000)
    expect(refreshCalls(calls)).toEqual([])
    expect(cb).not.toHaveBeenCalled()
  })
})

describe('createDocSession: polling (the host refreshes, plugins do not keep time)', () => {
  it('does not poll while the tab is inactive or the window is not focused', async () => {
    const { session, calls } = setup()
    await session.open(LOCAL)
    await vi.advanceTimersByTimeAsync(20_000)
    expect(refreshCalls(calls)).toEqual([])
  })

  it('polls a local document every cache.interval.focus.local while active', async () => {
    const { session, calls } = setup()
    session.setActive(true)
    const { docId } = await session.open(LOCAL)
    await vi.advanceTimersByTimeAsync(4999)
    expect(refreshCalls(calls)).toEqual([])
    await vi.advanceTimersByTimeAsync(1)
    expect(refreshCalls(calls)).toEqual([docId])
    await vi.advanceTimersByTimeAsync(5000)
    expect(refreshCalls(calls)).toEqual([docId, docId])
  })

  it('polls a UNC document every cache.interval.focus.network', async () => {
    const { session, calls } = setup()
    session.setActive(true)
    const { docId } = await session.open(UNC)
    await vi.advanceTimersByTimeAsync(9999)
    expect(refreshCalls(calls)).toEqual([])
    await vi.advanceTimersByTimeAsync(1)
    expect(refreshCalls(calls)).toEqual([docId])
  })

  it('stops when the tab becomes inactive / the window loses focus, and resumes', async () => {
    const { session, calls } = setup()
    session.setActive(true)
    const { docId } = await session.open(LOCAL)
    await vi.advanceTimersByTimeAsync(3000)
    session.setActive(false)
    await vi.advanceTimersByTimeAsync(20_000)
    expect(refreshCalls(calls)).toEqual([])
    session.setActive(true)
    await vi.advanceTimersByTimeAsync(5000)
    expect(refreshCalls(calls)).toEqual([docId])
  })

  it('does not overlap: the next poll is scheduled after the previous refresh returns', async () => {
    const { session, calls, hold } = setup()
    session.setActive(true)
    const { docId } = await session.open(LOCAL)
    const slow = hold('doc.refresh')
    await vi.advanceTimersByTimeAsync(5000)
    await vi.advanceTimersByTimeAsync(20_000)
    expect(refreshCalls(calls)).toEqual([docId])
    slow.resolve(info(docId, LOCAL))
    await vi.advanceTimersByTimeAsync(5000)
    expect(refreshCalls(calls)).toEqual([docId, docId])
  })

  it('refreshes at once on the tab refresh request (address bar / F5), even when inactive', async () => {
    const { session, calls, refresh } = setup()
    const { docId } = await session.open(LOCAL)
    refresh()
    expect(refreshCalls(calls)).toEqual([docId])
  })

  it('stops polling a missing document; F5 still checks it; a reset resumes polling', async () => {
    const s = setup()
    s.session.setActive(true)
    const { docId } = await s.session.open(LOCAL)
    const changes = vi.fn()
    s.session.onChanged(docId, changes)
    const pending = s.hold('doc.refresh')
    await vi.advanceTimersByTimeAsync(5000)
    s.emitChanged({ docId, missing: true })
    pending.resolve(info(docId, LOCAL))
    await settle()
    expect(changes).toHaveBeenCalledWith({ docId, missing: true, info: info(docId, LOCAL) })
    await vi.advanceTimersByTimeAsync(30_000)
    expect(refreshCalls(s.calls)).toHaveLength(1)
    // F5：文件又出现 → reset
    const back = info(docId, LOCAL, { size: 99 })
    s.infos.set(docId, back)
    const again = s.hold('doc.refresh')
    s.refresh()
    s.emitChanged({ docId, reset: true })
    again.resolve(back)
    await settle()
    expect(changes).toHaveBeenLastCalledWith({ docId, reset: true, info: back })
    await vi.advanceTimersByTimeAsync(5000)
    expect(refreshCalls(s.calls)).toHaveLength(3)
  })

  it('stops polling a document the main process no longer has (DOC_NOT_FOUND)', async () => {
    const s = setup()
    s.session.setActive(true)
    const { docId } = await s.session.open(LOCAL)
    s.refreshFails.set(docId, new AppError({ code: 'DOC_NOT_FOUND' }))
    await vi.advanceTimersByTimeAsync(5000)
    await vi.advanceTimersByTimeAsync(20_000)
    expect(refreshCalls(s.calls)).toHaveLength(1)
  })

  it('keeps polling after other refresh failures (e.g. a network timeout)', async () => {
    const s = setup()
    s.session.setActive(true)
    const { docId } = await s.session.open(UNC)
    s.refreshFails.set(docId, new AppError({ code: 'FS_TIMEOUT' }))
    await vi.advanceTimersByTimeAsync(20_000)
    expect(refreshCalls(s.calls)).toHaveLength(2)
  })
})

describe('createDocSession: changes', () => {
  it('delivers a change seen during a refresh together with the refreshed info', async () => {
    const s = setup()
    const { docId } = await s.session.open(LOCAL)
    const changes = vi.fn()
    s.session.onChanged(docId, changes)
    const grown = info(docId, LOCAL, { size: 20 })
    const pending = s.hold('doc.refresh')
    s.refresh()
    s.emitChanged({ docId, appended: true })
    expect(changes).not.toHaveBeenCalled()
    pending.resolve(grown)
    await settle()
    expect(changes).toHaveBeenCalledTimes(1)
    expect(changes).toHaveBeenCalledWith({ docId, appended: true, info: grown })
  })

  it('does not call back when a refresh found nothing new', async () => {
    const s = setup()
    const { docId } = await s.session.open(LOCAL)
    const changes = vi.fn()
    s.session.onChanged(docId, changes)
    s.refresh()
    await settle()
    expect(refreshCalls(s.calls)).toEqual([docId])
    expect(changes).not.toHaveBeenCalled()
  })

  it('fetches the info for a change the main process found on its own (re-judged encoding)', async () => {
    const s = setup()
    const { docId } = await s.session.open(LOCAL)
    const changes = vi.fn()
    s.session.onChanged(docId, changes)
    const sjis = info(docId, LOCAL, {
      encoding: { label: 'shift_jis', confidence: 'likely', bomLength: 0, manual: false }
    })
    s.infos.set(docId, sjis)
    s.emitChanged({ docId, reset: true })
    await settle()
    expect(refreshCalls(s.calls)).toEqual([docId])
    expect(changes).toHaveBeenCalledWith({ docId, reset: true, info: sjis })
  })

  it('ignores changes of other documents', async () => {
    const s = setup()
    const { docId } = await s.session.open(LOCAL)
    const changes = vi.fn()
    s.session.onChanged(docId, changes)
    s.emitChanged({ docId: 'other', reset: true })
    await settle()
    expect(refreshCalls(s.calls)).toEqual([])
    expect(changes).not.toHaveBeenCalled()
  })
})

describe('createDocSession: stale reads (generation)', () => {
  it('rejects a read that was in flight when a reset arrived; later reads are fine', async () => {
    const s = setup()
    const { docId } = await s.session.open(LOCAL)
    const pending = s.hold('doc.readLines')
    const read = s.session.readLines(docId, 0, 10)
    s.emitChanged({ docId, reset: true })
    pending.resolve(block(0))
    await expect(read).rejects.toBeInstanceOf(sdk.DocStaleError)
    await expect(s.session.readLines(docId, 0, 10)).resolves.toEqual(block(0))
  })

  it('does not reject reads for an appended change', async () => {
    const s = setup()
    const { docId } = await s.session.open(LOCAL)
    const pending = s.hold('doc.readLines')
    const read = s.session.readLines(docId, 0, 10)
    s.emitChanged({ docId, appended: true })
    pending.resolve(block(0))
    await expect(read).resolves.toEqual(block(0))
  })

  it.each(['setEncoding', 'buildIndex'] as const)(
    'rejects a read that was in flight when %s completed',
    async (op) => {
      const s = setup()
      const { docId } = await s.session.open(LOCAL)
      const pending = s.hold('doc.readLines')
      const read = s.session.readLines(docId, 0, 10)
      const done =
        op === 'setEncoding'
          ? s.session.setEncoding(docId, 'utf-16le')
          : s.session.buildIndex(docId)
      await expect(done).resolves.toEqual(info(docId, LOCAL))
      pending.resolve(block(0))
      await expect(read).rejects.toBeInstanceOf(sdk.DocStaleError)
      expect(s.calls).toContainEqual(
        op === 'setEncoding'
          ? ['doc.setEncoding', { docId, encoding: 'utf-16le' }]
          : ['doc.buildIndex', { docId }]
      )
    }
  )
})

describe('createDocSession: dispose (the tab content unmounts)', () => {
  it('closes the documents that are still open and stops polling', async () => {
    const s = setup()
    s.session.setActive(true)
    const a = await s.session.open(LOCAL)
    const b = await s.session.open(UNC)
    s.session.close(a.docId)
    s.session.dispose()
    expect(s.calls.filter(([c]) => c === 'doc.close')).toEqual([
      ['doc.close', { docId: a.docId }],
      ['doc.close', { docId: b.docId }]
    ])
    await vi.advanceTimersByTimeAsync(20_000)
    expect(refreshCalls(s.calls)).toEqual([])
  })

  it('closes a document whose open completes after dispose, and rejects that open', async () => {
    const s = setup()
    const pending = s.hold('doc.open')
    const opening = s.session.open(LOCAL)
    s.session.dispose()
    pending.resolve(info('late', LOCAL))
    await expect(opening).rejects.toMatchObject({ code: 'DOC_NOT_FOUND' })
    expect(s.calls).toContainEqual(['doc.close', { docId: 'late' }])
  })

  it('stays usable after dispose (React StrictMode runs effects twice)', async () => {
    const s = setup()
    s.session.dispose()
    s.session.setActive(true)
    const { docId } = await s.session.open(LOCAL)
    await vi.advanceTimersByTimeAsync(5000)
    expect(refreshCalls(s.calls)).toEqual([docId])
  })
})
