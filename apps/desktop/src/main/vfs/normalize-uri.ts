/**
 * 条目 / 根 URI 规范化：除驱动器根（`file:///C:/`）外不带结尾 `/`。缓存的 isUnder 以「根 + /」
 * 作前缀判断子目录，结尾多一个 `/` 会让子目录都不在根之下；渲染端的查询 key 也要与扫描进程
 * 发出的 vfs.changed 一致。
 */
export function normalizeRootUri(uri: string): string {
  const trimmed = uri.replace(/\/+$/, '')
  return /^file:\/\/\/[A-Za-z]:$/.test(trimmed) ? `${trimmed}/` : trimmed
}

/** uri 是否为 root 本身或其子孙（两者都应已规范化；按字面比较） */
export function isUnderUri(uri: string, root: string): boolean {
  if (uri === root) return true
  return uri.startsWith(root.endsWith('/') ? root : `${root}/`)
}
