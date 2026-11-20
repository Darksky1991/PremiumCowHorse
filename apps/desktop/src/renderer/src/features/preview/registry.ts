import {
  FALLBACK_PLUGIN_ID,
  TEXT_PLUGIN_ID,
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
 * 声明了 textLike 的插件对「判为文本」的资源（resource.textLike，只在没有插件按扩展名 / MIME 匹配时才判断）
 * 视为命中（0 分）：扩展名 / MIME 命中的插件优先；只声明了 textLike 的插件只接受判为文本的资源。
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
  // 只声明了 textLike（没有扩展名 / MIME）：只接受判为文本的资源，不能变成「匹配一切」
  if (!declared && manifest.match.textLike === true && !textLike) return null

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
 * 可用于资源的查看器（地址栏下拉、host.tabs.candidates）：按得分从高到低（同分先注册者在前）的匹配插件，
 * 文件另加文本插件（即使不按扩展名 / MIME 匹配，已注册时），最后是 fallback（文件信息）；无重复
 */
export function candidatesFor(
  plugins: readonly AnyPreviewPlugin[],
  resource: ResourceInfo
): AnyPreviewPlugin[] {
  const scored: { plugin: AnyPreviewPlugin; score: number }[] = []
  for (const plugin of plugins) {
    if (plugin.manifest.id === FALLBACK_PLUGIN_ID) continue
    const score = scoreResource(plugin.manifest, resource)
    if (score !== null) scored.push({ plugin, score })
  }
  // Array.prototype.sort 稳定：同分保持注册顺序
  const result = scored.sort((x, y) => y.score - x.score).map((x) => x.plugin)
  if (resource.kind === 'file') {
    const text = pluginById(plugins, TEXT_PLUGIN_ID)
    if (text !== null && !result.includes(text)) result.push(text)
  }
  result.push(fallbackOf(plugins))
  return result
}

/**
 * 文件名在 preview.associations（扩展名 → 插件 id）中的关联：取最长的扩展名（tar.gz 先于 gz），
 * 大小写不敏感；没有扩展名或没有关联时为 null
 */
export function associationFor(
  name: string,
  associations: Readonly<Record<string, string>>
): string | null {
  const keys = new Map<string, string>()
  for (const [ext, id] of Object.entries(associations)) {
    keys.set(ext.toLowerCase().replace(/^\./, ''), id)
  }
  const parts = name.toLowerCase().split('.')
  // parts[0] 是第一个点之前的部分，不是扩展名；从最长的后缀开始
  for (let i = 1; i < parts.length; i++) {
    const id = keys.get(parts.slice(i).join('.'))
    if (id !== undefined) return id
  }
  return null
}

/**
 * 选择查看器：用户为该位置选的 viewer（在候选中时）→ 设置 preview.associations 的关联（在候选中时）
 * → 按资源选择（pickPlugin）。不在候选中的 viewer / 关联被忽略
 */
export function resolvePlugin(
  plugins: readonly AnyPreviewPlugin[],
  resource: ResourceInfo,
  opts: { viewer: string | null; associations: Readonly<Record<string, string>> }
): AnyPreviewPlugin {
  const candidates = candidatesFor(plugins, resource)
  const byId = (id: string | null): AnyPreviewPlugin | undefined =>
    id === null ? undefined : candidates.find((p) => p.manifest.id === id)
  return (
    byId(opts.viewer) ??
    byId(associationFor(resource.name, opts.associations)) ??
    pickPlugin(plugins, resource)
  )
}

/** 列表中的 fallback 插件；没有时抛错（编程错误） */
export function fallbackOf(plugins: readonly AnyPreviewPlugin[]): AnyPreviewPlugin {
  const fallback = plugins.find((p) => p.manifest.id === FALLBACK_PLUGIN_ID)
  if (!fallback) throw new Error(`preview plugin ${FALLBACK_PLUGIN_ID} is not registered`)
  return fallback
}
