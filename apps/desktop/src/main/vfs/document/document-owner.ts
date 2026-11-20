// 文档归属窗口的生命周期（owner = webContents id，与 IPC 的 senderId 一致）。
import type { WebContents } from 'electron'
import type { DocumentService } from './document-service'

export type OwnerContents = Pick<WebContents, 'id' | 'on' | 'once'>

/**
 * - 主框架开始载入新文档（重新加载 / 导航；同文档内的导航与子框架除外）、渲染进程崩溃 / 被终止：
 *   关闭该窗口的全部文档（新页面不知道旧的 docId），之后照常受理 open
 * - webContents 销毁：全部释放
 */
export function bindDocumentOwner(
  contents: OwnerContents,
  docs: Pick<DocumentService, 'resetOwner' | 'releaseOwner'>
): void {
  const id = contents.id
  contents.on('did-start-navigation', (details) => {
    if (details.isMainFrame && !details.isSameDocument) docs.resetOwner(id)
  })
  contents.on('render-process-gone', () => docs.resetOwner(id))
  contents.once('destroyed', () => docs.releaseOwner(id))
}
