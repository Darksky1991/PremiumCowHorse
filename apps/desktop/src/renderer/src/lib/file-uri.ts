/**
 * `file:` URI → Windows 路径（渲染端没有 Node 的 fileURLToPath，供「复制路径」使用）。
 * `file:///C:/案件` → `C:\案件`；带主机名的 `file://server/share/x` → `\\server\share\x`。
 * 非 file 协议、无法解析或百分号解码失败时返回 null。
 */
export function fileUriToWindowsPath(uri: string): string | null {
  if (!URL.canParse(uri)) return null
  const url = new URL(uri)
  if (url.protocol !== 'file:') return null
  let pathname: string
  try {
    pathname = decodeURIComponent(url.pathname)
  } catch {
    return null
  }
  if (url.hostname !== '') return `\\\\${url.hostname}${pathname.replaceAll('/', '\\')}`
  // `/C:/x` → `C:\x`：去掉盘符前的斜杠
  return pathname.replace(/^\/(?=[A-Za-z]:)/, '').replaceAll('/', '\\')
}
