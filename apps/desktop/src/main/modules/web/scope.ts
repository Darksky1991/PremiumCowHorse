import { createHash } from 'node:crypto'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { isUnderUri } from '@pch/shared'

const SEGMENT_BASE = path.join(path.parse(process.cwd()).root, 'x')

export const WEB_SCHEME = 'pch-web'

/** 范围编号：`s` + sha256(范围根 URI) 的前 16 个十六进制字符（共 17 个字符；同一目录重启后不变，localStorage 稳定；`s` 前缀避免全数字的主机名被当作 IPv4 数字解析） */
export function scopeIdOf(rootUri: string): string {
  return 's' + createHash('sha256').update(rootUri).digest('hex').slice(0, 16)
}

function prefixOf(root: string): string {
  return root.endsWith('/') ? root : `${root}/`
}

/**
 * 范围内资源 URI → `pch-web://<范围编号>/<相对路径，逐段 encodeURIComponent>`。
 * URI 的每一段先 decodeURIComponent 得到真实名称，再按 URL 规则编码（#、?、% 不会截断路径）。
 * uri 不在 root 之下时抛错。
 */
export function toWebUrl(uri: string, rootUri: string): string {
  if (!isUnderUri(uri, rootUri)) throw new Error(`toWebUrl: ${uri} is not under ${rootUri}`)
  const rel = uri === rootUri ? '' : uri.slice(prefixOf(rootUri).length)
  const path = rel
    .split('/')
    .map((seg) => encodeURIComponent(decodeURIComponent(seg)))
    .join('/')
  return `${WEB_SCHEME}://${scopeIdOf(rootUri)}/${path}`
}

/**
 * 把真实名称编码为 file URI 的一段：直接取 `pathToFileURL` 的结果（含 Node 自己的额外转义，如 `~`），
 * 使 fromWebUrl 返回的 URI 与工作区条目的 URI 逐字符相同（项目按纯字符串比较 URI）。
 * 调用方保证 seg 不含 `/`、`\`。
 */
function encodeFileUriSegment(seg: string): string {
  const prefix = pathToFileURL(`${SEGMENT_BASE}${path.sep}`).href
  return pathToFileURL(`${SEGMENT_BASE}${path.sep}${seg}`).href.slice(prefix.length)
}

/** 范围编号 → 范围根 URI（只在内存；渲染端 attach 时登记） */
export class ScopeTable {
  private readonly roots = new Map<string, string>()

  register(rootUri: string): string {
    const id = scopeIdOf(rootUri)
    this.roots.set(id, rootUri)
    return id
  }

  rootOf(scopeId: string): string | undefined {
    return this.roots.get(scopeId)
  }
}

/**
 * `pch-web://` 地址 → 资源 URI。未登记的编号、非法路径、范围外一律 null；查询与片段忽略。
 * 路径逐段解码后拒绝：空段（`//`）、`.` / `..`、含 `/`、`\` 或 NUL 的段（`%2f`、`%5c`、`..%2f`），
 * 最后用 isUnderUri 复核。URL 解析本身会折叠字面的 `..` / `%2e%2e` 段，且不会越过主机部分。
 */
export function fromWebUrl(
  url: string,
  scopes: ScopeTable
): { uri: string; scopeId: string } | null {
  if (!URL.canParse(url)) return null
  const u = new URL(url)
  if (u.protocol !== `${WEB_SCHEME}:`) return null
  const scopeId = u.hostname
  const root = scopes.rootOf(scopeId)
  if (root === undefined) return null

  const raw = u.pathname.split('/').slice(1)
  if (raw.length > 0 && raw[raw.length - 1] === '') raw.pop() // 允许结尾的 /
  const segments: string[] = []
  for (const r of raw) {
    let seg: string
    try {
      seg = decodeURIComponent(r)
    } catch {
      return null
    }
    if (seg === '' || seg === '.' || seg === '..' || /[/\\\0]/.test(seg)) return null
    segments.push(seg)
  }
  const uri =
    segments.length === 0 ? root : prefixOf(root) + segments.map(encodeFileUriSegment).join('/')
  if (!isUnderUri(uri, root)) return null
  return { uri, scopeId }
}

/** 地址的范围编号是否已登记（区分「未登记 → 404」与「范围外 → 403」） */
export function isScopeRegistered(url: string, scopes: ScopeTable): boolean {
  return URL.canParse(url) && scopes.rootOf(new URL(url).hostname) !== undefined
}
