import { fileURLToPath, pathToFileURL } from 'node:url'
import { isUnderUri, type WebNotice } from '@pch/shared'
import { fromWebUrl, WEB_SCHEME, type ScopeTable } from './scope'

/** 视图主框架导航 / 新窗口请求的判定结果（设计 5.3.6）。视图自己一律不导航，按结果交给应用 / 系统浏览器 / 提示 */
export type NavDecision =
  /** fragment：链接的 `?查询#锚点`（资源 URI 不含它们；没有时为空字符串） */
  | { kind: 'app'; uri: string; newTab: boolean; fragment: string }
  | { kind: 'external'; url: string }
  | { kind: 'blocked'; notice: WebNotice }

/** 交给系统默认浏览器 / 邮件程序的协议（比应用窗口的白名单多 http:：内网系统常是 http，设计 Q6） */
const EXTERNAL_PROTOCOLS = new Set(['http:', 'https:', 'mailto:'])

/**
 * file: 地址 → 工作区 URI 的写法（fileURLToPath → pathToFileURL，与条目 URI 同一来源；查询与片段丢弃）。
 * 无法转换（编码的 `/`、非法主机等）→ null
 */
function canonicalFileUri(url: URL): string | null {
  try {
    return pathToFileURL(fileURLToPath(url, { windows: true }), { windows: true }).href
  } catch {
    return null
  }
}

/**
 * 判定视图内的导航目标：
 * - 同范围的 `pch-web://`、范围内的 `file:` → app（资源 URI；newTab 原样透传；查询与片段放在 fragment）
 * - `http:` / `https:` / `mailto:` → external（原样）
 * - 其他范围 / 未登记范围的 `pch-web://`、非法路径、范围外的 `file:` → blocked outOfScope
 * - 其他协议（`javascript:`、`data:`、`about:`、自定义协议……）与无法解析的地址 → blocked unsupported
 * 范围内外是纯字符串比较（isUnderUri），与协议处理器一致。
 */
export function decideNavigation(
  url: string,
  ctx: { scopeId: string; scopes: ScopeTable; newTab: boolean }
): NavDecision {
  const outOfScope: NavDecision = { kind: 'blocked', notice: 'outOfScope' }
  if (!URL.canParse(url)) return { kind: 'blocked', notice: 'unsupported' }
  const u = new URL(url)
  const fragment = u.search + u.hash

  if (u.protocol === `${WEB_SCHEME}:`) {
    const target = fromWebUrl(url, ctx.scopes)
    if (!target || target.scopeId !== ctx.scopeId) return outOfScope
    return { kind: 'app', uri: target.uri, newTab: ctx.newTab, fragment }
  }
  if (u.protocol === 'file:') {
    const root = ctx.scopes.rootOf(ctx.scopeId)
    const uri = canonicalFileUri(u)
    if (root === undefined || uri === null || !isUnderUri(uri, root)) return outOfScope
    return { kind: 'app', uri, newTab: ctx.newTab, fragment }
  }
  if (EXTERNAL_PROTOCOLS.has(u.protocol)) return { kind: 'external', url }
  return { kind: 'blocked', notice: 'unsupported' }
}
