/**
 * 已解码的相对路径（以 `/` 分段）是否含 `.` / `..` 段或 NUL：
 * 这类路径会被文件系统 / 服务器解析到别处，越过「在根之下」的字符串前缀判断。
 * 主进程（远程范围校验、网页视图 attach）共用，语义必须一致。
 */
export function hasDotSegment(relPath: string): boolean {
  if (relPath.includes('\0')) return true
  return relPath.split('/').some((seg) => seg === '.' || seg === '..')
}
