import {
  AppError,
  hasDotSegment,
  normalizeRootUri,
  parseSftpUri,
  SFTP_SCHEME,
  type SftpLocation,
  type WorkspaceEntry
} from '@pch/shared'

/** IPC handler 用到的部分（测试可注入假实现） */
export type RemoteScope = Pick<RemoteAccess, 'check' | 'filter'>

/**
 * 主进程的访问范围（M1-K17 的 sftp 部分，设计 devDoc/2026-11-22-37 第 5.7 节）：
 * `sftp:` URI 必须在某个工作区的远程 folder 条目之下（同一连接、同一身份、路径在其下），否则 IPC_FORBIDDEN。
 * 连接管理的通道按 connectionId 操作，不经这里。
 * UNC（`file://host/…`，M1-K17）同理：必须在 folder 条目或 file 条目所在目录之下；本地盘（host 为空）直接通过。
 *
 * 判断以解析后的位置为准，而不是字符串前缀：VfsService 经 `new URL()` 路由（scheme 大小写、前导空白、
 * `..` 都会被 URL 解析消化），SftpProvider 把解码后的路径交给服务器（`%2F..` 解码后成为 `..` 段，
 * 由服务器解析到根之外）。因此解码后含 `.` / `..` 段或 NUL 的路径一律拒绝。
 */
export class RemoteAccess {
  private roots: SftpLocation[] | null = null
  private uncRoots: UncLocation[] = []
  private readonly ready: Promise<void>
  private markReady!: () => void
  /** 进行中的根更新数（beginUpdate）；归零时 idle 完成 */
  private updates = 0
  private idle: Promise<void> = Promise.resolve()
  private markIdle: () => void = () => undefined

  constructor() {
    this.ready = new Promise<void>((resolve) => (this.markReady = resolve))
  }

  /**
   * 所有工作区的根（整体替换）：remote = sftp folder 条目根，unc = UNC（`file://host/…`）的 folder 条目根与
   * file 条目所在目录；第一次调用前 check 等待
   */
  setRoots(roots: { remote: readonly string[]; unc: readonly string[] }): void {
    const remote: SftpLocation[] = []
    for (const uri of roots.remote) {
      const loc = locate(uri)
      if (loc && safePath(loc.path)) remote.push(loc)
    }
    const unc: UncLocation[] = []
    for (const uri of roots.unc) {
      const loc = locateUnc(uri)
      if (loc) unc.push(loc)
    }
    this.roots = remote
    this.uncRoots = unc
    this.markReady()
  }

  /**
   * 登记一次进行中的根更新（bootstrap 的 push 在开始时调用，结束时调用返回的函数；重复调用无副作用）。
   * 条目添加提交、发出 workspace.changed 之后到 setRoots 之前，渲染端对新根的访问不应被拒绝：
   * 判为范围外且有更新在途时，check / filter 等全部更新结束后再判一次
   */
  beginUpdate(): () => void {
    if (this.updates === 0) this.idle = new Promise<void>((resolve) => (this.markIdle = resolve))
    this.updates++
    let ended = false
    return () => {
      if (ended) return
      ended = true
      if (--this.updates === 0) this.markIdle()
    }
  }

  /** 本地路径直接通过；sftp: / UNC 不在任何根之下 → IPC_FORBIDDEN */
  async check(uri: string): Promise<void> {
    if (!isRestricted(uri)) return
    await this.ready
    while (!this.allowed(uri)) {
      if (this.updates === 0) {
        throw new AppError({ code: 'IPC_FORBIDDEN', detail: 'outside entries' })
      }
      await this.idle
    }
  }

  /** 过滤（vfs.interest / vfs.refresh 的数组）：范围外的 sftp URI 丢弃，其余保持原样与顺序 */
  async filter(uris: readonly string[]): Promise<string[]> {
    if (!uris.some(isRestricted)) return [...uris]
    await this.ready
    const pass = (u: string): boolean => !isRestricted(u) || this.allowed(u)
    while (this.updates > 0 && !uris.every(pass)) await this.idle
    return uris.filter(pass)
  }

  private allowed(uri: string): boolean {
    if (!isSftp(uri)) {
      const unc = locateUnc(uri)
      if (!unc) return false
      return this.uncRoots.some(
        (r) =>
          r.host === unc.host &&
          (r.path === '' || unc.path === r.path || unc.path.startsWith(`${r.path}/`))
      )
    }
    const loc = locate(uri)
    if (!loc || !safePath(loc.path)) return false
    return (this.roots ?? []).some(
      (r) =>
        r.connectionId === loc.connectionId &&
        r.identity === loc.identity &&
        (r.path === '/' || loc.path === r.path || loc.path.startsWith(`${r.path}/`))
    )
  }
}

/** 与 VfsService 相同的方式判断 scheme（URL 解析：大小写不敏感、去掉首尾空白） */
function isSftp(uri: string): boolean {
  const url = URL.canParse(uri) ? new URL(uri) : null
  if (url) return url.protocol === SFTP_SCHEME
  // 无法解析的输入：sftp 前缀的按 sftp 处理（之后判为范围外），其余交给各自的校验
  return /^\s*sftp:/i.test(uri)
}

/** sftp: 或 UNC（host 非空的 file:）：需要在工作区条目范围内才放行 */
function isRestricted(uri: string): boolean {
  return isSftp(uri) || isUncUri(uri)
}

function isUncUri(uri: string): boolean {
  if (!URL.canParse(uri)) return false
  const url = new URL(uri)
  return url.protocol === 'file:' && url.host !== ''
}

/** UNC 位置：host（URL 已小写）+ 解码后小写的路径（SMB 路径大小写不敏感），无结尾 / */
interface UncLocation {
  host: string
  path: string
}

function locateUnc(uri: string): UncLocation | null {
  if (!isUncUri(uri)) return null
  const url = new URL(uri)
  let path: string
  try {
    path = decodeURIComponent(url.pathname)
  } catch {
    return null
  }
  // 解码后出现 \ / 或 .. 段、NUL：fileURLToPath 会拒绝或解析到别处，一律不放行
  if (path.includes('\\') || path.includes('\0') || hasDotSegment(path)) return null
  return { host: url.host, path: path.toLowerCase().replace(/\/+$/, '') }
}

function locate(uri: string): SftpLocation | null {
  if (!URL.canParse(uri)) return null
  return parseSftpUri(new URL(uri).href)
}

/** 解码后的路径不含 `.` / `..` 段与 NUL（服务器会据此解析到别处） */
function safePath(path: string): boolean {
  return !hasDotSegment(path)
}

/** 条目中的远程（sftp:）folder 根（规范化后，去重）：RemoteAccess 的根与连接重置时的刷新对象 */
export function remoteFolderRoots(entries: readonly WorkspaceEntry[]): string[] {
  const roots = new Set<string>()
  for (const e of entries) {
    if (e.kind !== 'folder' || e.uri === null) continue
    const uri = normalizeRootUri(e.uri)
    if (parseSftpUri(uri)) roots.add(uri)
  }
  return [...roots]
}

/**
 * UNC（file://host/…）条目的访问根：folder 条目自身，file 条目所在目录（M1-K17）。
 * 本地盘（host 为空）没有 NTLM 泄露面，不登记也不限制
 */
export function uncRoots(entries: readonly WorkspaceEntry[]): string[] {
  const roots = new Set<string>()
  for (const e of entries) {
    if (e.uri === null || (e.kind !== 'folder' && e.kind !== 'file')) continue
    const uri = normalizeRootUri(e.uri)
    if (!isUncUri(uri)) continue
    if (e.kind === 'folder') {
      roots.add(uri)
      continue
    }
    const cut = uri.lastIndexOf('/')
    const dir = uri.slice(0, cut)
    // 路径只有一段（file://host/x）时目录就是 host 根：此时只放行该 URI 本身，不放行整个主机
    roots.add(/^file:\/\/[^/]+\/.+/.test(dir) ? dir : uri)
  }
  return [...roots]
}
