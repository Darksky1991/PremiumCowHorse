import {
  FALLBACK_PLUGIN_ID,
  TEXT_PLUGIN_ID,
  type AnyPreviewPlugin,
  type PreviewPluginManifest,
  type ResourceInfo,
  type ViewAsMode
} from '@pch/plugin-sdk'

const EXTENSION_SCORE = 3
const MIME_EXACT_SCORE = 2
const MIME_WILDCARD_SCORE = 1

/** URI 的 scheme（不带冒号、小写）；无法解析时为 null */
function schemeOf(uri: string): string | null {
  const m = /^([A-Za-z][A-Za-z0-9+.-]*):/.exec(uri)
  return m ? m[1]!.toLowerCase() : null
}

/** 名称以「.扩展名」结尾（大小写不敏感，支持 tar.gz 这样的多段扩展名） */
function hasExtension(name: string, extension: string): boolean {
  return name.toLowerCase().endsWith(`.${extension.toLowerCase().replace(/^\./, '')}`)
}

function mimeScore(patterns: readonly string[], mime: string | null): number {
  if (mime === null) return 0
  const lower = mime.toLowerCase()
  let best = 0
  for (const p of patterns) {
    const pattern = p.toLowerCase()
    if (pattern === lower) best = Math.max(best, MIME_EXACT_SCORE)
    else if (pattern.endsWith('/*') && lower.startsWith(pattern.slice(0, -1))) {
      best = Math.max(best, MIME_WILDCARD_SCORE)
    } else if (pattern === '*/*' || pattern === '*') best = Math.max(best, MIME_WILDCARD_SCORE)
  }
  return best
}

/**
 * 插件对资源的匹配得分（doc 9.3）：扩展名命中 3 分、MIME 精确命中 2 分、MIME 通配命中 1 分，
 * 再加上 priority。kinds / schemes 不符、超过 maxSize、when 返回 false 时不匹配（null）；
 * 声明了 extensions 或 mimeTypes 却一项都没命中时也不匹配；都没声明时得 0 分（只按 kinds 等条件）。
 * 声明了 textLike 的插件对「判为文本」的资源（resource.textLike，只在没有插件按扩展名 / MIME 匹配时才判断）
 * 视为命中（0 分）：扩展名 / MIME 命中的插件优先。
 */
export function scoreResource(
  manifest: PreviewPluginManifest,
  resource: ResourceInfo
): number | null {
  const { kinds, extensions, mimeTypes, schemes, maxSize } = manifest.match
  if (kinds && !kinds.includes(resource.kind)) return null
  if (schemes) {
    const scheme = schemeOf(resource.uri)
    if (scheme === null || !schemes.some((s) => s.toLowerCase() === scheme)) return null
  }
  if (maxSize !== undefined && resource.size > maxSize) return null

  const ext = extensions?.some((e) => hasExtension(resource.name, e)) ? EXTENSION_SCORE : 0
  const mime = mimeTypes ? mimeScore(mimeTypes, resource.mime) : 0
  const declared = (extensions?.length ?? 0) + (mimeTypes?.length ?? 0) > 0
  const textLike = manifest.match.textLike === true && resource.textLike === true
  if (declared && ext + mime === 0 && !textLike) return null

  if (manifest.when && !manifest.when(resource)) return null
  return ext + mime + (manifest.priority ?? 0)
}

/**
 * 为资源选择插件：得分最高者（同分取先注册的）；没有任何插件匹配时用 fallback 插件。
 * fallback 插件不参与计分（它的 manifest 匹配一切）。列表中没有 fallback 插件时抛错（编程错误）。
 */
export function pickPlugin(
  plugins: readonly AnyPreviewPlugin[],
  resource: ResourceInfo
): AnyPreviewPlugin {
  let best: AnyPreviewPlugin | null = null
  let bestScore = -Infinity
  for (const plugin of plugins) {
    if (plugin.manifest.id === FALLBACK_PLUGIN_ID) continue
    const score = scoreResource(plugin.manifest, resource)
    if (score !== null && score > bestScore) {
      best = plugin
      bestScore = score
    }
  }
  return best ?? fallbackOf(plugins)
}

/**
 * 选择插件之前是否要先 sniff（读开头 8KB 判断文本 / 二进制）：非空文件、没有插件按扩展名 / MIME 等匹配、
 * 且有插件声明了 textLike。已判断过（resource.textLike 存在）时为 false
 */
export function needsSniff(plugins: readonly AnyPreviewPlugin[], resource: ResourceInfo): boolean {
  if (resource.kind !== 'file' || resource.size === 0 || resource.textLike !== undefined) {
    return false
  }
  if (!plugins.some((p) => p.manifest.match.textLike === true)) return false
  return pickPlugin(plugins, resource).manifest.id === FALLBACK_PLUGIN_ID
}

/** 按 id 找已注册的插件（「作为文本查看」等）；没有时为 null */
export function pluginById(
  plugins: readonly AnyPreviewPlugin[],
  id: string
): AnyPreviewPlugin | null {
  return plugins.find((p) => p.manifest.id === id) ?? null
}

/**
 * 考虑按标签的查看方式覆盖（host.tabs.viewAs）的选择：info → fallback 插件；text → 文本插件（未注册时 fallback）；
 * null → 按资源选择（pickPlugin）
 */
export function resolvePlugin(
  plugins: readonly AnyPreviewPlugin[],
  resource: ResourceInfo,
  viewAs: ViewAsMode | null
): AnyPreviewPlugin {
  if (viewAs === 'info') return fallbackOf(plugins)
  if (viewAs === 'text') return pluginById(plugins, TEXT_PLUGIN_ID) ?? fallbackOf(plugins)
  return pickPlugin(plugins, resource)
}

/**
 * 当前显示 currentId 的插件时能否切换到该查看方式：text 只对文件、文本插件已注册且不是当前插件；
 * info 只要当前不是 fallback 插件
 */
export function canViewAs(
  plugins: readonly AnyPreviewPlugin[],
  resource: Pick<ResourceInfo, 'kind'>,
  currentId: string,
  mode: ViewAsMode
): boolean {
  if (mode === 'info') return currentId !== FALLBACK_PLUGIN_ID
  return (
    resource.kind === 'file' &&
    currentId !== TEXT_PLUGIN_ID &&
    pluginById(plugins, TEXT_PLUGIN_ID) !== null
  )
}

/** 列表中的 fallback 插件；没有时抛错（编程错误） */
export function fallbackOf(plugins: readonly AnyPreviewPlugin[]): AnyPreviewPlugin {
  const fallback = plugins.find((p) => p.manifest.id === FALLBACK_PLUGIN_ID)
  if (!fallback) throw new Error(`preview plugin ${FALLBACK_PLUGIN_ID} is not registered`)
  return fallback
}
