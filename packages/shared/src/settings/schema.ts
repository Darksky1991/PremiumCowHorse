import { z } from 'zod'
import { CACHE_STRATEGIES } from '../scanner/types'

export const LANGUAGES = ['ja', 'zh-CN', 'en'] as const
export type Language = (typeof LANGUAGES)[number]

export const ACCENTS = ['neutral', 'blue', 'green', 'violet', 'orange'] as const
export type Accent = (typeof ACCENTS)[number]

/**
 * 设置项的唯一定义：同时提供默认值与校验。数据库只保存与默认值不同的键。
 * 新增设置项时只需在这里加一行。
 */
export const settingsSchema = z.object({
  'general.language': z.enum(['system', ...LANGUAGES]).default('system'),
  'appearance.themeMode': z.enum(['system', 'light', 'dark']).default('system'),
  'appearance.accent': z.enum(ACCENTS).default('neutral'),
  'appearance.density': z.enum(['comfortable', 'compact']).default('comfortable'),
  'explorer.showHiddenFiles': z.boolean().default(false),
  /**
   * 资源树：单击 / 键盘移动选中（400ms 防抖）即在当前标签打开（M1-3b 设计 2.8；键名沿用 M1-3 以免迁移）。
   * false 时单击与 ↑↓ 只选中，Enter / 文件双击打开
   */
  'explorer.singleClickPreview': z.boolean().default(true),
  'preview.associations': z.record(z.string(), z.string()).default({}),
  'preview.maxTextSizeMB': z.number().int().min(1).max(500).default(50),
  'session.restoreOnStartup': z.boolean().default(true),
  'window.onDetachedClose': z.enum(['close-tabs', 'return-to-main']).default('return-to-main'),
  /** 暂无用途（远程文件下载缓存不在 M4 范围） */
  'remote.cacheSizeMB': z.number().int().min(100).default(1024),
  /** SFTP 保活间隔（秒）；连续 3 次无响应视为断线 */
  'remote.keepaliveSec': z.number().int().min(5).max(120).default(15),
  /** 远程连接无请求多少分钟后自动断开 */
  'remote.idleDisconnectMin': z.number().int().min(1).max(60).default(5),
  /** 远程文件系统调用的超时（秒） */
  'vfs.timeoutSec.remote': z.number().int().min(5).max(120).default(20),
  /** 远程目录后台填充缓存时，每个目录完成后的休息时间（毫秒） */
  'cache.backgroundGapMs.remote': z.number().int().min(100).default(500),
  /** 远程目录建立索引的间隔（分钟） */
  'cache.remoteIndexIntervalMin': z.number().int().min(5).max(1440).default(30),
  /** 缓存策略的全局默认（设计 8）：本地「积极」、网络「默认」；条目可单独设置 */
  'cache.strategy.local': z.enum(CACHE_STRATEGIES).default('active'),
  'cache.strategy.network': z.enum(CACHE_STRATEGIES).default('default'),
  /** 「积极」策略以关注点为中心上下的层数 */
  'cache.activeDepth': z.number().int().min(1).max(10).default(3),
  /** 定期确认的间隔（秒）：关注点 / 近 / 远三层 */
  'cache.interval.focus.local': z.number().int().min(2).default(5),
  'cache.interval.focus.network': z.number().int().min(10).default(10),
  'cache.interval.near.local': z.number().int().min(2).default(30),
  'cache.interval.near.network': z.number().int().min(10).default(60),
  'cache.interval.far.local': z.number().int().min(2).default(120),
  'cache.interval.far.network': z.number().int().min(10).default(300),
  /** 后台填充缓存时，每个目录完成后的休息时间（毫秒） */
  'cache.backgroundGapMs.local': z.number().int().min(100).default(500),
  'cache.backgroundGapMs.network': z.number().int().min(500).default(2000),
  /** 文件系统调用的超时（秒）：扫描进程按「没有进展的时间」计，VfsService 的一次性调用按总时长计 */
  'vfs.timeoutSec.local': z.number().int().min(1).max(60).default(5),
  'vfs.timeoutSec.network': z.number().int().min(10).max(120).default(10),
  'launcher.autoUploadRemoteEdits': z.boolean().default(true),
  // 退出本应用时是否询问保存哪些桌面项目；false = 不询问、全部保存
  'desktop.askOnExit': z.boolean().default(true)
})

export type Settings = z.infer<typeof settingsSchema>
export type SettingKey = keyof Settings

/**
 * 设置的部分更新。注意不能用 settingsSchema.partial()：zod 4 中 partial 之后
 * .default() 仍会生效，未传的键会被填成默认值，导致一次更新把其他设置全部重置。
 * 因此逐个字段取出 default 内层的类型再设为 optional。
 */
type SettingsShape = typeof settingsSchema.shape
const patchShape = Object.fromEntries(
  Object.entries(settingsSchema.shape).map(([key, field]) => [key, field.unwrap().optional()])
) as { [K in keyof SettingsShape]: z.ZodOptional<ReturnType<SettingsShape[K]['unwrap']>> }

export const SettingsPatch = z.strictObject(patchShape)
export type SettingsPatch = z.infer<typeof SettingsPatch>

export const DEFAULT_SETTINGS: Settings = settingsSchema.parse({})

/**
 * 把数据库中的原始键值合并到默认值上。
 * 单个键校验失败（例如旧版本残留的非法值）时回退到默认值，不影响其他键。
 */
export function resolveSettings(stored: Record<string, unknown>): Settings {
  const result: Record<string, unknown> = { ...DEFAULT_SETTINGS }
  for (const [key, value] of Object.entries(stored)) {
    const field = settingsSchema.shape[key as SettingKey]
    if (!field) continue
    const parsed = field.safeParse(value)
    if (parsed.success) result[key] = parsed.data
  }
  return result as Settings
}

/** 把「system」语言解析为实际使用的语言 */
export function resolveLanguage(
  setting: Settings['general.language'],
  systemLocale: string
): Language {
  if (setting !== 'system') return setting
  const lower = systemLocale.toLowerCase()
  if (lower.startsWith('ja')) return 'ja'
  if (lower.startsWith('zh')) return 'zh-CN'
  return 'en'
}
