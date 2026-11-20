import type { HandlersOf } from '../../ipc/router'
import type { DocumentService } from './document-service'

/** handler 用到的 DocumentService 部分（测试可注入假实现） */
export type DocumentApi = Pick<
  DocumentService,
  'open' | 'readLines' | 'refresh' | 'setEncoding' | 'buildIndex' | 'close'
>

/** 参数已由路由按契约校验（count ≤ 2000 等）；文档归属调用方窗口（senderId） */
export function documentHandlers(
  docs: DocumentApi
): HandlersOf<
  'doc.open' | 'doc.readLines' | 'doc.refresh' | 'doc.setEncoding' | 'doc.buildIndex' | 'doc.close'
> {
  return {
    'doc.open': (input, ctx) => docs.open(ctx.senderId, input),
    'doc.readLines': ({ docId, start, count }, ctx) =>
      docs.readLines(ctx.senderId, docId, start, count),
    'doc.refresh': ({ docId }, ctx) => docs.refresh(ctx.senderId, docId),
    'doc.setEncoding': ({ docId, encoding }, ctx) =>
      docs.setEncoding(ctx.senderId, docId, encoding),
    'doc.buildIndex': ({ docId }, ctx) => docs.buildIndex(ctx.senderId, docId),
    'doc.close': async ({ docId }, ctx) => docs.close(ctx.senderId, docId)
  }
}
