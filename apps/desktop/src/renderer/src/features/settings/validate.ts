import { settingsSchema, type SettingKey, type Settings } from '@pch/shared'

/**
 * 校验失败的原因代码（界面按代码取本地化文案，见 settings 命名空间的 error.*）：
 * required 未输入；invalid 不是数字 / 不在可选值内；integer 不是整数；range 超出 schema 的 min / max
 */
export type ValidationMessage = 'required' | 'invalid' | 'integer' | 'range'

export type ValidationResult<K extends SettingKey> =
  { ok: true; value: Settings[K] } | { ok: false; message: ValidationMessage }

/** 设置项的输入形态，全部从 schema 读取（与 zod 同源，不另写一份范围） */
export type FieldKind =
  | { type: 'boolean' }
  | { type: 'enum'; options: readonly string[] }
  | { type: 'number'; min: number | undefined; max: number | undefined }
  | { type: 'record' }

/** zod 的 int() 在没有显式上限时给出的安全整数边界，不当作范围显示 */
function bound(value: number | null | undefined): number | undefined {
  if (value === null || value === undefined) return undefined
  return Math.abs(value) >= Number.MAX_SAFE_INTEGER ? undefined : value
}

export function describeField(key: SettingKey): FieldKind {
  const inner = settingsSchema.shape[key].unwrap() as unknown
  if (inner instanceof Object && 'options' in inner && Array.isArray(inner.options)) {
    return { type: 'enum', options: inner.options as string[] }
  }
  if (inner instanceof Object && 'minValue' in inner) {
    const n = inner as { minValue: number | null; maxValue: number | null }
    return { type: 'number', min: bound(n.minValue), max: bound(n.maxValue) }
  }
  const sample = settingsSchema.shape[key].safeParse(undefined)
  const value: unknown = sample.success ? sample.data : undefined
  return typeof value === 'boolean' ? { type: 'boolean' } : { type: 'record' }
}

/**
 * 校验一个设置项的输入。数值项接受输入框的字符串（转为数字）；
 * 通过时返回 schema 解析后的值，失败时返回原因代码
 */
export function validateSetting<K extends SettingKey>(key: K, raw: unknown): ValidationResult<K> {
  const field = settingsSchema.shape[key]
  const kind = describeField(key)
  let input = raw
  if (kind.type === 'number' && typeof raw === 'string') {
    const text = raw.trim()
    if (text === '') return { ok: false, message: 'required' }
    input = Number(text)
  }
  if (typeof input === 'number') {
    if (Number.isNaN(input)) return { ok: false, message: 'invalid' }
    if (!Number.isInteger(input)) return { ok: false, message: 'integer' }
  }
  const parsed = field.safeParse(input)
  if (parsed.success) return { ok: true, value: parsed.data as Settings[K] }
  return { ok: false, message: kind.type === 'number' ? 'range' : 'invalid' }
}
