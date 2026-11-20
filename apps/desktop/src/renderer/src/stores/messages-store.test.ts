import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMessagesStore, type ToastApi } from './messages-store'

interface FakeCall {
  level: string
  text: string
  id: string
  onDismiss: () => void
  onAutoClose: () => void
}

function setup(): {
  store: ReturnType<typeof createMessagesStore>
  calls: FakeCall[]
  dismissed: string[]
} {
  const calls: FakeCall[] = []
  const dismissed: string[] = []
  const api = {
    show: vi.fn((level, text, opts) => {
      calls.push({ level, text, ...opts })
    }),
    dismiss: vi.fn((id: string) => {
      dismissed.push(id)
    })
  } as unknown as ToastApi
  const store = createMessagesStore(api)
  return { store, calls, dismissed }
}

describe('messages-store', () => {
  let ctx: ReturnType<typeof setup>
  beforeEach(() => {
    ctx = setup()
  })

  it('tracks visible toasts and removes on user dismiss without stashing', () => {
    const { store, calls: raw } = ctx
    const calls = raw as [FakeCall, ...FakeCall[]]
    store.getState().notify('error', 'e1')
    expect(store.getState().visible).toEqual([calls[0].id])
    calls[0].onDismiss()
    expect(store.getState().visible).toEqual([])
    expect(store.getState().tray).toEqual([])
  })

  it('stashes error / warning on auto close, drops info / success', () => {
    const { store, calls: raw } = ctx
    const calls = raw as [FakeCall, ...FakeCall[]]
    store.getState().notify('error', 'e')
    store.getState().notify('warning', 'w')
    store.getState().notify('info', 'i')
    store.getState().notify('success', 's')
    for (const c of calls) c.onAutoClose()
    expect(store.getState().visible).toEqual([])
    expect(store.getState().tray.map((m) => m.text)).toEqual(['w', 'e'])
  })

  it('stashVisible dismisses all and stashes them regardless of level', () => {
    const { store, calls: raw, dismissed } = ctx
    const calls = raw as [FakeCall, ...FakeCall[]]
    store.getState().notify('info', 'i')
    store.getState().notify('error', 'e')
    store.getState().stashVisible()
    expect(dismissed.sort()).toEqual(calls.map((c) => c.id).sort())
    // sonner 随后触发 onDismiss：不能当作用户确认
    for (const c of calls) c.onDismiss()
    expect(store.getState().visible).toEqual([])
    expect(store.getState().tray.map((m) => m.text)).toEqual(['e', 'i'])
  })

  it('caps the tray at 50 dropping the oldest', () => {
    const { store, calls: raw } = ctx
    const calls = raw as [FakeCall, ...FakeCall[]]
    for (let i = 0; i < 52; i++) store.getState().notify('error', `m${i}`)
    for (const c of calls) c.onAutoClose()
    const tray = store.getState().tray
    expect(tray).toHaveLength(50)
    expect(tray[0]?.text).toBe('m51')
    expect(tray[49]?.text).toBe('m2')
  })

  it('restoreTray re-shows messages, empties tray and can be stashed again', () => {
    const { store, calls: raw } = ctx
    const calls = raw as [FakeCall, ...FakeCall[]]
    store.getState().notify('error', 'e')
    calls[0].onAutoClose()
    expect(store.getState().tray).toHaveLength(1)
    store.getState().restoreTray()
    expect(store.getState().tray).toEqual([])
    expect(calls).toHaveLength(2)
    expect(calls[1]?.text).toBe('e')
    expect(store.getState().visible).toEqual([calls[1]?.id])
    store.getState().stashVisible()
    calls[1]?.onDismiss()
    expect(store.getState().tray.map((m) => m.text)).toEqual(['e'])
  })

  it('does not stash the same id twice', () => {
    const { store, calls: raw } = ctx
    const calls = raw as [FakeCall, ...FakeCall[]]
    store.getState().notify('error', 'e')
    calls[0].onAutoClose()
    calls[0].onAutoClose()
    expect(store.getState().tray).toHaveLength(1)
  })
})
