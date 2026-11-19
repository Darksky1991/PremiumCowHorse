import {
  FALLBACK_PLUGIN_ID,
  type AnyPreviewPlugin,
  type PreviewPluginManifest,
  type ResourceInfo
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
  if (declared && ext + mime === 0) return null

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

/** 列表中的 fallback 插件；没有时抛错（编程错误） */
export function fallbackOf(plugins: readonly AnyPreviewPlugin[]): AnyPreviewPlugin {
  const fallback = plugins.find((p) => p.manifest.id === FALLBACK_PLUGIN_ID)
  if (!fallback) throw new Error(`preview plugin ${FALLBACK_PLUGIN_ID} is not registered`)
  return fallback
}
