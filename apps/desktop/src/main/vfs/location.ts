import { createRequire } from 'node:module'
import { isSftpUri, sftpConnectionKey } from '@pch/shared'
import type { LocationKind } from '@pch/shared'
import { fileUriToLocalPath } from './local-path'

/**
 * 位置类型与并发分组的键（主进程与扫描进程共用；不依赖 electron）。
 * - UNC（file://host/share/...）→ network；shareKey `\\host\share`、hostKey `host`（均小写）
 * - sftp:// → remote；shareKey / hostKey 均为连接键 `sftp://<connectionId>`（不含身份）
 * - 盘符 → GetDriveTypeW 为 DRIVE_REMOTE（映射的网络盘）时 network，否则 local；
 *   shareKey 为大写盘符加冒号。映射盘对应的服务器暂不解析（WNetGetConnectionW），
 *   hostKey 直接用盘符，使每个映射盘各自成为一组；本地盘的 hostKey 为 'local'。
 */
export type { LocationKind }

export interface Locator {
  location(uri: string): LocationKind
  shareKey(uri: string): string
  hostKey(uri: string): string
}

/** GetDriveTypeW(rootPath)；null = 无法取得（koffi 不可用、非 Windows），盘符一律视为 local */
export type DriveTypeFn = (root: string) => number

const DRIVE_REMOTE = 4

type Parsed = { unc: true; host: string; share: string } | { unc: false; drive: string }

function parse(uri: string): Parsed {
  const p = fileUriToLocalPath(uri)
  if (p.startsWith('\\\\')) {
    const [host = '', share = ''] = p.slice(2).split('\\')
    return { unc: true, host: host.toLowerCase(), share: share.toLowerCase() }
  }
  const m = /^([A-Za-z]):/.exec(p)
  // fileUriToLocalPath 对 Windows 路径只会给出 UNC 或盘符；其余情况（理论上不会出现）按本地处理
  return { unc: false, drive: m ? `${m[1]!.toUpperCase()}:` : p }
}

export function createLocator(driveType: DriveTypeFn | null): Locator {
  // 映射盘的增减很少见，进程内按盘符缓存
  const remote = new Map<string, boolean>()
  const isRemoteDrive = (drive: string): boolean => {
    let r = remote.get(drive)
    if (r === undefined) {
      r = driveType !== null && driveType(`${drive}\\`) === DRIVE_REMOTE
      remote.set(drive, r)
    }
    return r
  }
  return {
    location(uri) {
      if (isSftpUri(uri)) return 'remote'
      const p = parse(uri)
      return p.unc || isRemoteDrive(p.drive) ? 'network' : 'local'
    },
    shareKey(uri) {
      if (isSftpUri(uri)) return sftpConnectionKey(uri)
      const p = parse(uri)
      return p.unc ? `\\\\${p.host}\\${p.share}` : p.drive
    },
    hostKey(uri) {
      if (isSftpUri(uri)) return sftpConnectionKey(uri)
      const p = parse(uri)
      if (p.unc) return p.host
      return isRemoteDrive(p.drive) ? p.drive : 'local'
    }
  }
}

/** GetDriveTypeW 不可用的原因（loadDriveType 失败时记下，供 driveTypeStatus 报告） */
let loadError: string | undefined

/** 用 koffi 加载 GetDriveTypeW；失败（非 Windows、原生模块缺失）返回 null */
function loadDriveType(): DriveTypeFn | null {
  if (process.platform !== 'win32') {
    loadError = `not supported on ${process.platform}`
    return null
  }
  try {
    const koffi = createRequire(import.meta.url)('koffi') as typeof import('koffi')
    const GetDriveTypeW = koffi
      .load('kernel32.dll')
      .func('uint32_t __stdcall GetDriveTypeW(const char16_t *lpRootPathName)')
    return (root) => GetDriveTypeW(root) as number
  } catch (e) {
    loadError = e instanceof Error ? e.message : String(e)
    return null
  }
}

let defaultLocator: Locator | undefined
const getDefault = (): Locator => (defaultLocator ??= createLocator(loadDriveType()))

/**
 * 默认 locator 能否识别映射的网络盘（GetDriveTypeW 经 koffi 加载成功）。
 * 不可用时盘符一律按本地处理；主进程启动时据此写一条日志（打包后确认 koffi 可用）。
 */
export function driveTypeStatus(): { native: true } | { native: false; error: string } {
  getDefault()
  return loadError === undefined ? { native: true } : { native: false, error: loadError }
}

export const location = (uri: string): LocationKind => getDefault().location(uri)
export const shareKey = (uri: string): string => getDefault().shareKey(uri)
export const hostKey = (uri: string): string => getDefault().hostKey(uri)
