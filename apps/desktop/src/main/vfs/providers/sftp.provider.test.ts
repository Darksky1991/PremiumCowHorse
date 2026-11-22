import { describe, expect, it, vi, type Mock } from 'vitest'
import { AppError, parseSftpUri, sftpChildUri } from '@pch/shared'
import {
  ownerOfLongname,
  SftpProvider,
  type SftpAttrs,
  type SftpDirEntry,
  type SftpSession,
  type SftpSessionSource
} from './sftp.provider'

const ID = '0a1b2c3d-0000-4000-8000-000000000001'
const DIR = 0o040000
const LNK = 0o120000
const REG = 0o100000
const sig = new AbortController().signal

function attrs(mode: number, size = 10, mtime = 100): SftpAttrs {
  return { mode, size, mtime }
}
function notFound(): Error {
  return Object.assign(new Error('No such file'), { code: 2 })
}

/** 内存目录树：路径 → attrs；目录路径 → 子项 */
function fakeSession(
  tree: Record<string, SftpAttrs>,
  dirs: Record<string, SftpDirEntry[]>
): SftpSession {
  const get = async (p: string): Promise<SftpAttrs> => {
    const a = tree[p]
    if (!a) throw notFound()
    return a
  }
  return {
    stat: get,
    lstat: get,
    readdir: async (p) => {
      const d = dirs[p]
      if (!d) throw notFound()
      return d
    },
    realpath: async (p) => p
  }
}

function sourceOf(...sessions: SftpSession[]): {
  session: Mock<SftpSessionSource['session']>
  invalidate: Mock<SftpSessionSource['invalidate']>
} {
  let i = 0
  return {
    session: vi.fn<SftpSessionSource['session']>(
      async () => sessions[Math.min(i++, sessions.length - 1)] as SftpSession
    ),
    invalidate: vi.fn<SftpSessionSource['invalidate']>()
  }
}

describe('SftpProvider.list', () => {
  const names = ['a b', '100%', 'x#y', 'q?z', '日本語', 'p+q', '.hidden']
  const entries: SftpDirEntry[] = [
    { filename: '.', longname: '', attrs: attrs(DIR) },
    { filename: '..', longname: '', attrs: attrs(DIR) },
    ...names.map((n) => ({
      filename: n,
      longname: `-rw-r--r-- 1 app1 app1 10 Nov 22 10:00 ${n}`,
      attrs: attrs(REG, 10, 100)
    })),
    { filename: 'd', longname: '', attrs: attrs(DIR, 4096, 5) },
    { filename: 'lnk', longname: '', attrs: attrs(LNK, 3) },
    { filename: 'dead', longname: '', attrs: attrs(LNK, 3) }
  ]
  const tree = { '/opt/lnk': attrs(DIR) }
  const mk = (): SftpProvider => new SftpProvider(sourceOf(fakeSession(tree, { '/opt': entries })))

  it('child URIs round-trip and names are preserved', async () => {
    const dir = `sftp://${ID}/opt`
    const items = await mk().list(new URL(dir), sig)
    expect(items.map((x) => x.uri)).toEqual(
      [...names, 'd', 'lnk', 'dead'].map((n) => sftpChildUri(dir, n))
    )
    for (const it of items) {
      expect(new URL(it.uri).href).toBe(it.uri)
      expect(parseSftpUri(it.uri)).not.toBeNull()
    }
    const first = items[0]
    expect(first).toMatchObject({
      name: 'a b',
      kind: 'file',
      size: 10,
      mtime: 100_000,
      hidden: false,
      owner: 'app1'
    })
    expect(items.find((x) => x.name === '.hidden')?.hidden).toBe(true)
    expect(items.find((x) => x.name === 'd')).toMatchObject({ kind: 'directory', size: 0 })
  })

  it('symlinks resolve target kind, dangling is null', async () => {
    const items = await mk().list(new URL(`sftp://${ID}/opt`), sig)
    expect(items.find((x) => x.name === 'lnk')).toMatchObject({
      kind: 'symlink',
      target: 'directory'
    })
    expect(items.find((x) => x.name === 'dead')).toMatchObject({ kind: 'symlink', target: null })
  })

  it('invalid uri -> FS_INVALID_URI', async () => {
    await expect(mk().list(new URL('sftp:///x'), sig)).rejects.toMatchObject({
      code: 'FS_INVALID_URI'
    })
  })
})

describe('SftpProvider.stat', () => {
  it('root name is / and uri is the request href', async () => {
    const p = new SftpProvider(
      sourceOf(fakeSession({ '/': attrs(DIR), '/a/b': attrs(REG, 7, 2) }, {}))
    )
    const root = await p.stat(new URL(`sftp://${ID}`), sig)
    expect(root).toMatchObject({ name: '/', kind: 'directory', size: 0 })
    const url = new URL(`sftp://${ID}/a/b`)
    expect(await p.stat(url, sig)).toMatchObject({ uri: url.href, name: 'b', size: 7, mtime: 2000 })
  })
})

describe('retry', () => {
  const unavailable = (): SftpSession => ({
    ...fakeSession({}, {}),
    stat: async () => {
      throw new AppError({ code: 'FS_UNAVAILABLE' })
    }
  })
  const good = (): SftpSession => fakeSession({ '/x': attrs(REG) }, {})
  const url = new URL(`sftp://${ID}/x`)

  it('userAction retries once with a new session', async () => {
    const src = sourceOf(unavailable(), good())
    const s = await new SftpProvider(src).stat(url, sig, { userAction: true })
    expect(s.name).toBe('x')
    expect(src.invalidate).toHaveBeenCalledTimes(1)
    expect(src.session).toHaveBeenCalledTimes(2)
  })

  it('background does not retry', async () => {
    const src = sourceOf(unavailable(), good())
    await expect(new SftpProvider(src).stat(url, sig, { userAction: false })).rejects.toMatchObject(
      { code: 'FS_UNAVAILABLE' }
    )
    expect(src.session).toHaveBeenCalledTimes(1)
  })

  it('session() errors are not retried', async () => {
    const src = sourceOf()
    src.session.mockRejectedValue(new AppError({ code: 'CONN_AUTH_FAILED' }))
    await expect(new SftpProvider(src).stat(url, sig)).rejects.toMatchObject({
      code: 'CONN_AUTH_FAILED'
    })
    expect(src.session).toHaveBeenCalledTimes(1)
  })

  it('second failure propagates', async () => {
    const src = sourceOf(unavailable(), unavailable())
    await expect(new SftpProvider(src).stat(url, sig)).rejects.toMatchObject({
      code: 'FS_UNAVAILABLE'
    })
    expect(src.session).toHaveBeenCalledTimes(2)
  })
})

describe('unsupported / owner', () => {
  it('read and createReadStream reject without connecting', async () => {
    const src = sourceOf()
    const p = new SftpProvider(src)
    await expect(p.read()).rejects.toMatchObject({ code: 'FS_UNSUPPORTED_SCHEME' })
    await expect(p.createReadStream()).rejects.toMatchObject({ code: 'FS_UNSUPPORTED_SCHEME' })
    expect(src.session).not.toHaveBeenCalled()
  })

  it('ownerOfLongname', () => {
    expect(ownerOfLongname('drwxr-x--- 2 app1 app1 4096 Nov 22 10:00 log')).toBe('app1')
    expect(ownerOfLongname('')).toBeUndefined()
  })
})
