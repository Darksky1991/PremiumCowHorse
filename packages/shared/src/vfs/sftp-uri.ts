/**
 * sftp: URI 的唯一定义（不依赖 Node，主进程 / 扫描进程 / 渲染端共用）。
 * 形式：sftp://[身份@]<connectionId>[/路径]；根路径省略 '/'，路径逐段 encodeURIComponent。
 */
export const SFTP_SCHEME = 'sftp:'

/** 可切换的目标身份（用户名）：同时用于命令行拼接，必须保持严格 */
export const IDENTITY_PATTERN = /^[a-z_][a-z0-9_.-]{0,31}$/

export interface SftpLocation {
  connectionId: string
  /** 切换的身份；null = 登录用户 */
  identity: string | null
  /** 解码后的绝对路径，根为 '/' */
  path: string
}

export function isSftpUri(uri: string): boolean {
  return uri.startsWith('sftp:')
}

function encodePath(path: string): string {
  if (path === '/' || path === '') return ''
  return path
    .split('/')
    .slice(1)
    .map((seg) => '/' + encodeURIComponent(seg))
    .join('')
}

export function parseSftpUri(uri: string): SftpLocation | null {
  if (!isSftpUri(uri)) return null
  let url: URL
  try {
    url = new URL(uri)
  } catch {
    return null
  }
  if (url.protocol !== SFTP_SCHEME) return null
  if (!url.hostname || url.password) return null
  let identity: string | null = null
  if (url.username) {
    try {
      identity = decodeURIComponent(url.username)
    } catch {
      return null
    }
    if (!IDENTITY_PATTERN.test(identity)) return null
  }
  let path = '/'
  if (url.pathname && url.pathname !== '/') {
    const segs = url.pathname.split('/').slice(1)
    if (segs[segs.length - 1] === '') segs.pop() // 末尾 '/'
    try {
      path = '/' + segs.map(decodeURIComponent).join('/')
    } catch {
      return null
    }
  }
  return { connectionId: url.hostname, identity, path }
}

export function formatSftpUri(loc: SftpLocation): string {
  const user = loc.identity ? `${encodeURIComponent(loc.identity)}@` : ''
  return `sftp://${user}${loc.connectionId}${encodePath(loc.path)}`
}

/** 子项 URI：与渲染端 descend 的拼接方式一致（在目录 URI 后接 '/' + 编码后的名字） */
export function sftpChildUri(dirUri: string, name: string): string {
  const base = dirUri.replace(/\/+$/, '')
  return `${base}/${encodeURIComponent(name)}`
}

/** 父目录 URI；根（无路径）返回 null */
export function sftpParentUri(uri: string): string | null {
  const loc = parseSftpUri(uri)
  if (!loc || loc.path === '/') return null
  const i = loc.path.lastIndexOf('/')
  return formatSftpUri({ ...loc, path: i <= 0 ? '/' : loc.path.slice(0, i) })
}

/** 最后一段的名字（解码后）；根返回空串 */
export function sftpNameOf(uri: string): string {
  const loc = parseSftpUri(uri)
  if (!loc || loc.path === '/') return ''
  return loc.path.slice(loc.path.lastIndexOf('/') + 1)
}

/** 连接键：同一连接的不同身份共用同一条物理连接，因此不含身份 */
export function sftpConnectionKey(uri: string): string {
  const loc = parseSftpUri(uri)
  return `sftp://${loc ? loc.connectionId : ''}`
}
