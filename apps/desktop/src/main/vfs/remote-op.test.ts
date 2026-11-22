import { describe, expect, it, vi } from 'vitest'
import { AppError, type FileEntry, type FileStat } from '@pch/shared'
import { createRemoteOp, type RemoteOpProvider } from './remote-op'

const DIR = 'sftp://c1/var/log'

const codeOf = (p: Promise<unknown>): Promise<string> =>
  p.then(
    () => 'resolved',
    (e: unknown) => (e instanceof AppError ? e.code : `not an AppError: ${String(e)}`)
  )

type CheckFn = ReturnType<typeof vi.fn<(uri: string) => Promise<void>>>

function setup(
  over: Partial<RemoteOpProvider> = {},
  check: CheckFn = vi.fn<(uri: string) => Promise<void>>(async () => undefined)
): {
  op: ReturnType<typeof createRemoteOp>
  provider: RemoteOpProvider
  check: CheckFn
  order: string[]
} {
  const order: string[] = []
  check.mockImplementation(async () => {
    order.push('check')
  })
  const provider: RemoteOpProvider = {
    stat: vi.fn(async (uri: URL): Promise<FileStat> => {
      order.push('stat')
      return { uri: uri.href, name: 'log', kind: 'directory', size: 0, mtime: 1234 }
    }),
    list: vi.fn(async (uri: URL): Promise<FileEntry[]> => {
      order.push('list')
      return [
        {
          uri: `${uri.href}/a`,
          name: 'a',
          kind: 'file',
          size: 1,
          mtime: 2,
          hidden: false,
          owner: 'app1'
        },
        {
          uri: `${uri.href}/l`,
          name: 'l',
          kind: 'symlink',
          target: null,
          size: 0,
          mtime: 3,
          hidden: false
        }
      ]
    }),
    ...over
  }
  return { op: createRemoteOp({ access: { check }, provider }), provider, check, order }
}

describe('createRemoteOp', () => {
  it('checks the access scope first, then stats the directory and returns its mtime', async () => {
    const { op, provider, order } = setup()
    const signal = new AbortController().signal
    expect(await op({ op: 'stat', uri: DIR, userAction: true }, signal)).toEqual({ mtime: 1234 })
    expect(order).toEqual(['check', 'stat'])
    expect(provider.stat).toHaveBeenCalledWith(new URL(DIR), signal, { userAction: true })
  })

  it('rejects a stat of a non-directory with FS_NOT_A_DIRECTORY', async () => {
    const { op } = setup({
      stat: async (uri) => ({ uri: uri.href, name: 'f', kind: 'file', size: 1, mtime: 1 })
    })
    expect(
      await codeOf(op({ op: 'stat', uri: DIR, userAction: false }, new AbortController().signal))
    ).toBe('FS_NOT_A_DIRECTORY')
  })

  it('lists without the uri field and keeps owner / target', async () => {
    const { op, provider } = setup()
    const signal = new AbortController().signal
    expect(await op({ op: 'list', uri: DIR, userAction: false }, signal)).toEqual([
      { name: 'a', kind: 'file', size: 1, mtime: 2, hidden: false, owner: 'app1' },
      { name: 'l', kind: 'symlink', target: null, size: 0, mtime: 3, hidden: false }
    ])
    expect(provider.list).toHaveBeenCalledWith(new URL(DIR), signal, { userAction: false })
  })

  it('does not touch the provider when the URI is outside the access scope', async () => {
    const check = vi.fn<(uri: string) => Promise<void>>(async () => undefined)
    const { op, provider } = setup({}, check)
    check.mockImplementation(async () => {
      throw new AppError({ code: 'IPC_FORBIDDEN' })
    })
    expect(
      await codeOf(op({ op: 'list', uri: DIR, userAction: true }, new AbortController().signal))
    ).toBe('IPC_FORBIDDEN')
    expect(provider.list).not.toHaveBeenCalled()
  })
})
