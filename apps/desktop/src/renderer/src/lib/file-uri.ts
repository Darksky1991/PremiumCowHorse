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

/**
 * `file:` URI 所在的共享 / 卷的键，规则与主进程 vfs/location.ts 的 shareKey 一致：
 * UNC → `\\host\share`（小写）；盘符 → 大写盘符加冒号（`C:`）。非 file 协议或无法解析时返回 null。
 * 映射网络盘在渲染端无法识别（需要 GetDriveTypeW），其键就是盘符本身，与主进程对映射盘的规则相同。
 */
export function shareKeyOfUri(uri: string): string | null {
  if (!URL.canParse(uri)) return null
  const url = new URL(uri)
  if (url.protocol !== 'file:') return null
  if (url.hostname !== '') {
    const share = url.pathname.split('/')[1] ?? ''
    let decoded = share
    try {
      decoded = decodeURIComponent(share)
    } catch {
      // 保留原样
    }
    return `\\\\${url.hostname}\\${decoded}`.toLowerCase()
  }
  const drive = /^\/([A-Za-z]):/.exec(url.pathname)
  return drive ? `${drive[1]!.toUpperCase()}:` : null
}

/** URI 所在的共享 / 卷是否在已断开的集合中（键比较不区分大小写：主进程事件的 share 与此处同规则） */
export function isShareOffline(
  uri: string,
  offlineShares: Readonly<Record<string, number>>
): boolean {
  const key = shareKeyOfUri(uri)
  if (key === null) return false
  const lower = key.toLowerCase()
  return Object.keys(offlineShares).some((k) => k.toLowerCase() === lower)
}

/**
 * 与主进程 normalizeRootUri 同规则：去掉结尾的 `/`，驱动器根 `file:///C:` 保留 `/`。
 * 渲染端把节点 URI 与 index.list 返回的（已规范化的）URI 比较时使用。
 */
export function normalizeFileUri(uri: string): string {
  const trimmed = uri.replace(/\/+$/, '')
  return /^file:\/\/\/[A-Za-z]:$/.test(trimmed) ? `${trimmed}/` : trimmed
}

/** UNC（带主机名的 file://host/share/...）位置；盘符（含无法识别的映射盘）为 false */
export function isUncUri(uri: string): boolean {
  return shareKeyOfUri(uri)?.startsWith('\\\\') ?? false
}
