import { describe, expect, it, vi } from 'vitest'
import { AppError, type DirectoryListing, type FileEntry } from '@pch/shared'
import { vfsHandlers, type ScannerApi } from './vfs.ipc'
import type { VfsService } from './vfs.service'

const ctx = { senderId: 7 }
const uri = 'file:///C:/a'
const items: FileEntry[] = [
  { uri: `${uri}/x.txt`, name: 'x.txt', kind: 'file', size: 1, mtime: 1, hidden: false }
]
const cached: DirectoryListing = { items, state: 'cached', checkedAt: 100 }

function setup(scanner: Partial<ScannerApi> & { available: boolean }): {
  handlers: ReturnType<typeof vfsHandlers>
  vfs: { list: ReturnType<typeof vi.fn>; stat: ReturnType<typeof vi.fn> }
} {
  const vfs = { list: vi.fn(async () => items), stat: vi.fn(), cancel: vi.fn() }
  const full: ScannerApi = {
    list: vi.fn(async () => cached),
    interest: vi.fn(),
    refresh: vi.fn(),
    cacheInfo: vi.fn(async () => ({ bytes: 0 })),
    clearCache: vi.fn(async () => undefined),
    cancelSearch: vi.fn(),
    ...scanner
  }
  return { handlers: vfsHandlers(vfs as unknown as VfsService, full), vfs }
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
    const i = { focus: uri, visible: [uri], offscreen: [] }
    await handlers['vfs.interest'](i, ctx)
    expect(interest).toHaveBeenCalledWith(7, i)
    await handlers['vfs.refresh']({ uris: [uri] }, ctx)
    expect(refresh).toHaveBeenCalledWith([uri])
  })
})
