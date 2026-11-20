import { AppError, type DirectoryListing } from '@pch/shared'
import { sniff, SNIFF_BYTES } from '@pch/text-engine'
import type { HandlersOf } from '../ipc/router'
import type { ScannerClient } from './scanner-client'
import type { VfsService } from './vfs.service'

/** handler 用到的 ScannerClient 部分（测试可注入假实现） */
export type ScannerApi = Pick<
  ScannerClient,
  | 'available'
  | 'list'
  | 'interest'
  | 'refresh'
  | 'cacheInfo'
  | 'clearCache'
  | 'cancelSearch'
  | 'offlineShares'
>

/**
 * 扫描进程不可用（超过重启上限、index.db 打不开等）。客户端的兜底超时是 FS_TIMEOUT，不回退：
 * 扫描进程可能仍在同一共享上枚举，回退会并发第二次访问
 */
const isUnavailable = (e: unknown): boolean =>
  e instanceof AppError && e.code === 'INDEX_UNAVAILABLE'

/**
 * 参数已由路由按契约校验。目录列表经扫描进程（缓存 + 调度）；扫描进程不可用时退回
 * VfsService 直接枚举、不缓存（降级模式，设计 4.1）。
 */
export function vfsHandlers(
  vfs: VfsService,
  scanner: ScannerApi
): HandlersOf<
  | 'vfs.stat'
  | 'vfs.list'
  | 'vfs.cancel'
  | 'vfs.interest'
  | 'vfs.refresh'
  | 'vfs.offlineShares'
  | 'vfs.cacheInfo'
  | 'vfs.clearCache'
  | 'vfs.sniff'
> {
  const listDirectly = async (uri: string, requestId?: string): Promise<DirectoryListing> => ({
    items: await vfs.list(uri, requestId),
    state: 'fresh',
    checkedAt: Date.now()
  })
  return {
    'vfs.stat': ({ uri }) => vfs.stat(uri),
    'vfs.list': async ({ uri, requestId }) => {
      if (!scanner.available) return listDirectly(uri, requestId)
      try {
        return await scanner.list(uri)
      } catch (e) {
        if (!isUnavailable(e)) throw e
        return listDirectly(uri, requestId)
      }
    },
    'vfs.cancel': async ({ requestId }) => {
      vfs.cancel(requestId)
      scanner.cancelSearch(requestId)
    },
    'vfs.interest': async (interest, ctx) => scanner.interest(ctx.senderId, interest),
    'vfs.refresh': async ({ uris }) => scanner.refresh(uris),
    'vfs.offlineShares': async () => scanner.offlineShares(),
    'vfs.cacheInfo': () => scanner.cacheInfo(),
    'vfs.clearCache': () => scanner.clearCache(),
    // 开头 8KB（开-读-关）判断文本 / 二进制；BOM 等细节由 doc.open 的 DocumentInfo 提供
    'vfs.sniff': async ({ uri }) => ({ kind: sniff(await vfs.read(uri, 0, SNIFF_BYTES)).kind })
  }
}
