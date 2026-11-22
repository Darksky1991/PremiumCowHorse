import { describe, expect, it, vi } from 'vitest'
import { AppError, type DirectoryListing, type FileEntry } from '@pch/shared'
import { RemoteAccess } from './remote-access'
import { vfsHandlers, type ScannerApi } from './vfs.ipc'
import type { VfsService } from './vfs.service'

const ctx = { senderId: 7 }
const uri = 'file:///C:/a'
const items: FileEntry[] = [
  { uri: `${uri}/x.txt`, name: 'x.txt', kind: 'file', size: 1, mtime: 1, hidden: false }
]
const cached: DirectoryListing = { items, state: 'cached', checkedAt: 100 }

function setup(
  scanner: Partial<ScannerApi> & { available: boolean },
  remoteRoots: string[] = []
): {
  handlers: ReturnType<typeof vfsHandlers>
  vfs: {
    list: ReturnType<typeof vi.fn>
    stat: ReturnType<typeof vi.fn>
    read: ReturnType<typeof vi.fn>
  }
} {
  const vfs = { list: vi.fn(async () => items), stat: vi.fn(), cancel: vi.fn(), read: vi.fn() }
  const full: ScannerApi = {
    list: vi.fn(async () => cached),
    interest: vi.fn(),
    refresh: vi.fn(),
    cacheInfo: vi.fn(async () => ({ bytes: 0 })),
    clearCache: vi.fn(async () => undefined),
    cancelSearch: vi.fn(),
    offlineShares: vi.fn(() => []),
    ...scanner
  }
  const access = new RemoteAccess()
  access.setRoots(remoteRoots)
  return { handlers: vfsHandlers(vfs as unknown as VfsService, full, access), vfs }
}

describe('vfsHandlers vfs.list', () => {
  it('扫描进程可用时返回扫描进程的结果（缓存与状态），不直接枚举', async () => {
    const { handlers, vfs } = setup({ available: true })
    await expect(handlers['vfs.list']({ uri, requestId: 'dir:a' }, ctx)).resolves.toEqual(cached)
    expect(vfs.list).not.toHaveBeenCalled()
  })

  it('扫描进程不可用（降级模式）时直接枚举，state 为 fresh、checkedAt 为当前时刻', async () => {
    const list = vi.fn()
    const { handlers, vfs } = setup({ available: false, list })
    const before = Date.now()
    const r = await handlers['vfs.list']({ uri, requestId: 'dir:a' }, ctx)
    expect(r.items).toBe(items)
    expect(r.state).toBe('fresh')
    expect(r.checkedAt).toBeGreaterThanOrEqual(before)
    expect(r.checkedAt).toBeLessThanOrEqual(Date.now())
    expect(vfs.list).toHaveBeenCalledWith(uri, 'dir:a')
    expect(list).not.toHaveBeenCalled()
  })

  it('扫描进程以 INDEX_UNAVAILABLE 拒绝（例如 index.db 无法打开）时同样回退到直接枚举', async () => {
    const { handlers, vfs } = setup({
      available: true,
      list: vi.fn(async () => {
        throw new AppError({ code: 'INDEX_UNAVAILABLE', detail: 'cannot open the index' })
      })
    })
    const r = await handlers['vfs.list']({ uri }, ctx)
    expect(r).toMatchObject({ items, state: 'fresh' })
    expect(vfs.list).toHaveBeenCalledWith(uri, undefined)
  })

  it('客户端兜底超时（FS_TIMEOUT）原样抛出，不回退到直接枚举', async () => {
    const { handlers, vfs } = setup({
      available: true,
      list: vi.fn(async () => {
        throw new AppError({ code: 'FS_TIMEOUT', detail: 'no result within 60s' })
      })
    })
    await expect(handlers['vfs.list']({ uri }, ctx)).rejects.toMatchObject({
      code: 'FS_TIMEOUT'
    })
    expect(vfs.list).not.toHaveBeenCalled()
  })

  it('扫描进程返回的文件系统错误原样抛出，不回退', async () => {
    const { handlers, vfs } = setup({
      available: true,
      list: vi.fn(async () => {
        throw new AppError({ code: 'FS_NOT_FOUND', detail: uri })
      })
    })
    await expect(handlers['vfs.list']({ uri }, ctx)).rejects.toMatchObject({
      code: 'FS_NOT_FOUND'
    })
    expect(vfs.list).not.toHaveBeenCalled()
  })
})

describe('vfsHandlers 的其他通道', () => {
  it('interest 以调用方窗口为 owner 转发；refresh 原样转发', async () => {
    const interest = vi.fn()
    const refresh = vi.fn()
    const { handlers } = setup({ available: true, interest, refresh })
    const i = { focus: uri, visible: [uri], offscreen: [], tabs: [uri] }
    await handlers['vfs.interest'](i, ctx)
    expect(interest).toHaveBeenCalledWith(7, i)
    await handlers['vfs.refresh']({ uris: [uri] }, ctx)
    expect(refresh).toHaveBeenCalledWith([uri])
  })

  it('offlineShares 返回扫描进程客户端记录的断开共享', async () => {
    const offline = [{ share: 'E:', since: 10 }]
    const { handlers } = setup({ available: true, offlineShares: vi.fn(() => offline) })
    await expect(handlers['vfs.offlineShares']({}, ctx)).resolves.toEqual(offline)
  })
})

describe('vfsHandlers vfs.sniff', () => {
  it('reads the first 8KB and returns only the kind', async () => {
    const { handlers, vfs } = setup({ available: true })
    vfs.read.mockResolvedValueOnce(new TextEncoder().encode('hello world'))
    await expect(handlers['vfs.sniff']({ uri }, ctx)).resolves.toEqual({ kind: 'text' })
    expect(vfs.read).toHaveBeenCalledWith(uri, 0, 8192)
    vfs.read.mockResolvedValueOnce(Uint8Array.of(0x50, 0x4b, 0x00, 0x01))
    await expect(handlers['vfs.sniff']({ uri }, ctx)).resolves.toEqual({ kind: 'binary' })
    vfs.read.mockResolvedValueOnce(new Uint8Array(0))
    await expect(handlers['vfs.sniff']({ uri }, ctx)).resolves.toEqual({ kind: 'empty' })
  })
})

describe('vfsHandlers 的访问范围（sftp:）', () => {
  const root = 'sftp://c1/opt'
  const inside = 'sftp://c1/opt/app'
  const outside = 'sftp://c1/etc'

  it('stat / list / sniff：范围外为 IPC_FORBIDDEN，不访问文件系统', async () => {
    const list = vi.fn(async () => cached)
    const { handlers, vfs } = setup({ available: true, list }, [root])
    for (const call of [
      handlers['vfs.stat']({ uri: outside }, ctx),
      handlers['vfs.list']({ uri: outside }, ctx),
      handlers['vfs.sniff']({ uri: outside }, ctx)
    ]) {
      await expect(call).rejects.toMatchObject({ code: 'IPC_FORBIDDEN' })
    }
    expect(vfs.stat).not.toHaveBeenCalled()
    expect(vfs.read).not.toHaveBeenCalled()
    expect(list).not.toHaveBeenCalled()
    await handlers['vfs.list']({ uri: inside }, ctx)
    expect(list).toHaveBeenCalledWith(inside)
    vfs.stat.mockResolvedValueOnce({})
    await handlers['vfs.stat']({ uri: inside }, ctx)
    expect(vfs.stat).toHaveBeenCalledWith(inside)
  })

  it('interest / refresh：丢弃范围外的 URI（focus 范围外 → null）', async () => {
    const interest = vi.fn()
    const refresh = vi.fn()
    const { handlers } = setup({ available: true, interest, refresh }, [root])
    await handlers['vfs.interest'](
      { focus: outside, visible: [uri, outside, inside], offscreen: [outside], tabs: [inside] },
      ctx
    )
    expect(interest).toHaveBeenCalledWith(7, {
      focus: null,
      visible: [uri, inside],
      offscreen: [],
      tabs: [inside]
    })
    await handlers['vfs.refresh']({ uris: [outside, inside, uri] }, ctx)
    expect(refresh).toHaveBeenCalledWith([inside, uri])
  })
})
