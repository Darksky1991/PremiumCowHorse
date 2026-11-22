import { isSftpUri, parseSftpUri } from '@pch/shared'
import { fileUriToWindowsPath } from './file-uri'

/**
 * 显示用的路径（地址栏、文件信息、标签提示、搜索结果、工作区总览；设计 devDoc/2026-11-22-37 第 5.8 节）：
 * file → Windows 路径；sftp → `<连接名>:<路径>`（切换身份时 `<身份>@<连接名>:<路径>`，
 * 连接不在 names 中时用 connectionId）；其余（网页、无法解析的 URI）原样。
 * 连接名由调用方经 data/connections 取得后传入（lib 不依赖 data）
 */
export function displayPath(
  uri: string,
  connectionNames: Readonly<Record<string, string>>
): string {
  if (isSftpUri(uri)) {
    const loc = parseSftpUri(uri)
    if (loc === null) return uri
    const name = connectionNames[loc.connectionId] ?? loc.connectionId
    return `${loc.identity === null ? '' : `${loc.identity}@`}${name}:${loc.path}`
  }
  return fileUriToWindowsPath(uri) ?? uri
}

/**
 * 「复制路径」的内容：file → Windows 路径；sftp → 服务器上的绝对路径（身份与连接不在其中，
 * 「复制 URI」才含它们）；其余（网页、无法解析的 URI）为 null
 */
export function copyablePath(uri: string): string | null {
  if (isSftpUri(uri)) return parseSftpUri(uri)?.path ?? null
  return fileUriToWindowsPath(uri)
}

/** 本机资源（file:）：系统操作（用系统应用打开、在资源管理器中显示、作为文本查看）只对它可用 */
export function isLocalUri(uri: string): boolean {
  return /^file:/i.test(uri)
}
