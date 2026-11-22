import {
  AppError,
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
 * 连接管理的通道按 connectionId 操作，不经这里；`file:` 的 K17 不在本次范围（直接通过）。
 *
 * 判断以解析后的位置为准，而不是字符串前缀：VfsService 经 `new URL()` 路由（scheme 大小写、前导空白、
 * `..` 都会被 URL 解析消化），SftpProvider 把解码后的路径交给服务器（`%2F..` 解码后成为 `..` 段，
 * 由服务器解析到根之外）。因此解码后含 `.` / `..` 段或 NUL 的路径一律拒绝。
 */
export class RemoteAccess {
  private roots: SftpLocation[] | null = null
  private readonly ready: Promise<void>
  private markReady!: () => void
  /** 进行中的根更新数（beginUpdate）；归零时 idle 完成 */
  private updates = 0
  private idle: Promise<void> = Promise.resolve()
  private markIdle: () => void = () => undefined

  constructor() {
    this.ready = new Promise<void>((resolve) => (this.markReady = resolve))
  }

  /** 所有工作区的 sftp folder 条目根（整体替换）；第一次调用前 check 等待 */
  setRoots(uris: readonly string[]): void {
    const roots: SftpLocation[] = []
    for (const uri of uris) {
      const loc = locate(uri)
      if (loc && safePath(loc.path)) roots.push(loc)
    }
    this.roots = roots
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

  /** 非 sftp: 直接通过；sftp: 不在任何根之下 → IPC_FORBIDDEN */
  async check(uri: string): Promise<void> {
    if (!isSftp(uri)) return
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
    if (!uris.some(isSftp)) return [...uris]
    await this.ready
    const pass = (u: string): boolean => !isSftp(u) || this.allowed(u)
    while (this.updates > 0 && !uris.every(pass)) await this.idle
    return uris.filter(pass)
  }

  private allowed(uri: string): boolean {
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

function locate(uri: string): SftpLocation | null {
  if (!URL.canParse(uri)) return null
  return parseSftpUri(new URL(uri).href)
}

/** 解码后的路径不含 `.` / `..` 段与 NUL（服务器会据此解析到别处） */
function safePath(path: string): boolean {
  if (path.includes('\0')) return false
  return path.split('/').every((seg) => seg !== '.' && seg !== '..')
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
