/**
 * 「添加远程文件夹」的路径输入 → 规范化的绝对路径（formatSftpUri 的 path）；无效时为 null。
 * 只接受以 / 开头的绝对路径；重复与结尾的 / 去掉（根保持 /）。`.` / `..` 段不接受：
 * 服务器上的解析结果与 URI 不再逐字符一致（缓存键、访问范围的前缀判断都以 URI 为准）
 */
export function normalizeRemotePath(input: string): string | null {
  const path = input.trim()
  if (!path.startsWith('/') || path.includes('\0')) return null
  const segments = path.split('/').filter((s) => s !== '')
  if (segments.some((s) => s === '.' || s === '..')) return null
  return `/${segments.join('/')}`
}
