import { z } from 'zod'

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
  'explorer.singleClickPreview': z.boolean().default(true),
  'preview.associations': z.record(z.string(), z.string()).default({}),
  'preview.maxTextSizeMB': z.number().int().min(1).max(500).default(50),
  'session.restoreOnStartup': z.boolean().default(true),
  'window.onDetachedClose': z.enum(['close-tabs', 'return-to-main']).default('return-to-main'),
  'remote.cacheSizeMB': z.number().int().min(100).default(1024),
  'remote.pollIntervalSec': z.number().int().min(0).default(0),
  'launcher.officeExtensions': z
    .array(z.string())
    .default(['xlsx', 'xlsm', 'xls', 'xltx', 'docx', 'doc', 'dotx', 'pptx', 'ppt', 'potx']),
  'launcher.officeDefaultAction': z.enum(['readOnly', 'edit', 'ask']).default('readOnly'),
  'launcher.autoUploadRemoteEdits': z.boolean().default(true)
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
