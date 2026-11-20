import path from 'node:path'

const trimSeparators = (p: string): string => p.replace(/[\\/]+$/, '')

/**
 * 路径的显示名称：通常是最后一段。路径本身就是根时（驱动器根 `C:\`、UNC 共享根
 * `\\server\share\`），显示去掉末尾分隔符的根：path.basename 对驱动器根返回空字符串，
 * 对 UNC 共享根只返回 `share`（不同服务器上的同名共享无法区分）。
 */
export function displayName(p: string): string {
  const root = path.parse(p).root
  if (root && trimSeparators(p) === trimSeparators(root)) return trimSeparators(root) || root
  return path.basename(p)
}
