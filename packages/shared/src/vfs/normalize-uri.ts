/**
 * 条目 / 根 URI 规范化：除驱动器根（`file:///C:/`）外不带结尾 `/`。缓存的 isUnder 以「根 + /」
 * 作前缀判断子目录，结尾多一个 `/` 会让子目录都不在根之下；渲染端的查询 key 也要与扫描进程
 * 发出的 vfs.changed 一致。
 */
export function normalizeRootUri(uri: string): string {
  const trimmed = uri.replace(/\/+$/, '')
  return /^file:\/\/\/[A-Za-z]:$/.test(trimmed) ? `${trimmed}/` : trimmed
}

/** 目录 URI 的「根前缀」：根已以 / 结尾（驱动器根 file:///C:/）时不再追加 */
export function prefixOf(root: string): string {
  return root.endsWith('/') ? root : `${root}/`
}

/**
 * uri 是否等于 root 或在 root 之下。纯字符串比较、大小写敏感（与 URI 原样一致）：
 * Windows 路径大小写不敏感，大小写不同的同一目录会被视为不同目录——
 * 这里依赖 URI 来自同一来源（工作区条目 + pathToFileURL(path.join(...))）而保持一致。
 * 主进程（索引目标是否在 folder 之下）、扫描进程（缓存、调度器的根覆盖）与渲染端共用本实现（不依赖 Node API），语义必须一致。
 */
export function isUnderUri(uri: string, root: string): boolean {
  return uri === root || uri.startsWith(prefixOf(root))
}
