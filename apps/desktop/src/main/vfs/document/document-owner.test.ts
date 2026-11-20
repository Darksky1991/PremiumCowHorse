import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { bindDocumentOwner, type OwnerContents } from './document-owner'

function setup(): {
  contents: EventEmitter & { id: number }
  docs: { resetOwner: ReturnType<typeof vi.fn>; releaseOwner: ReturnType<typeof vi.fn> }
} {
  const contents = Object.assign(new EventEmitter(), { id: 7 })
  const docs = { resetOwner: vi.fn(), releaseOwner: vi.fn() }
  bindDocumentOwner(contents as unknown as OwnerContents, docs)
  return { contents, docs }
}

const navigation = (isMainFrame: boolean, isSameDocument: boolean): object => ({
  isMainFrame,
  isSameDocument,
  url: 'app://index.html',
  preventDefault: () => undefined,
  defaultPrevented: false
})

describe('bindDocumentOwner', () => {
  it('closes the documents when the main frame starts a new document (reload)', () => {
    const { contents, docs } = setup()
    contents.emit('did-start-navigation', navigation(true, false))
    expect(docs.resetOwner).toHaveBeenCalledWith(7)
  })

  it('ignores same-document navigations and subframes', () => {
    const { contents, docs } = setup()
    contents.emit('did-start-navigation', navigation(true, true))
    contents.emit('did-start-navigation', navigation(false, false))
    expect(docs.resetOwner).not.toHaveBeenCalled()
  })

  it('closes the documents when the renderer process is gone', () => {
    const { contents, docs } = setup()
    contents.emit('render-process-gone', {}, { reason: 'crashed', exitCode: 1 })
    expect(docs.resetOwner).toHaveBeenCalledWith(7)
  })

  it('releases the owner when the web contents is destroyed', () => {
    const { contents, docs } = setup()
    contents.emit('destroyed')
    expect(docs.releaseOwner).toHaveBeenCalledWith(7)
  })
})
