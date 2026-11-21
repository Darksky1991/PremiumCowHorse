import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { net, protocol } from 'electron'

export const APP_SCHEME = 'app'
export const APP_BASE_URL = 'app://renderer/'

/** 必须在 app ready 之前调用 */
export function registerPrivilegedSchemes(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: APP_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, codeCache: true }
    },
    // 浏览器视图（modules/web）：pch-web 提供范围内的本地文件，pch-asset 提供 Markdown 查看脚本。
    // 处理器只注册在浏览器视图的会话上（persist:pch-web）
    ...['pch-web', 'pch-asset'].map((scheme) => ({
      scheme,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        stream: true
      }
    }))
  ])
}

/**
 * app:// 协议：提供渲染端静态文件（Electron 安全指南建议用自定义协议代替 file://）。
 * CSP 由 index.html 的 meta 标签声明。
 */
export function registerAppProtocol(rendererDir: string): void {
  const root = path.resolve(rendererDir)
  protocol.handle(APP_SCHEME, async (request) => {
    const { pathname } = new URL(request.url)
    let filePath = path.normalize(path.join(root, decodeURIComponent(pathname)))
    if (filePath !== root && !filePath.startsWith(root + path.sep)) {
      return new Response('Forbidden', { status: 403 })
    }
    if (pathname.endsWith('/')) filePath = path.join(filePath, 'index.html')

    return net.fetch(pathToFileURL(filePath).toString())
  })
}
