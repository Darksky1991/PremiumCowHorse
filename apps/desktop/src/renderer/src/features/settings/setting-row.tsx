import { useState, type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { THEMES, DEFAULT_SETTINGS, type SettingKey, type ThemeName } from '@pch/shared'
import { cn } from 'cn'
import { Button } from '@pch/ui/components/button'
import { Input } from '@pch/ui/components/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@pch/ui/components/select'
import { Switch } from '@pch/ui/components/switch'
import { useResolvedTheme } from '@renderer/providers/theme-context'
import { itemId } from './sections'
import { describeField, validateSetting } from './validate'

/** 数值项的单位（schema 不带单位信息）；没有列出的数值项不显示单位 */
const UNITS: Partial<Record<SettingKey, 'sec' | 'ms' | 'min' | 'mb'>> = {
  'preview.maxTextSizeMB': 'mb',
  'remote.keepaliveSec': 'sec',
  'remote.idleDisconnectMin': 'min',
  'vfs.timeoutSec.remote': 'sec',
  'vfs.timeoutSec.local': 'sec',
  'vfs.timeoutSec.network': 'sec',
  'cache.backgroundGapMs.local': 'ms',
  'cache.backgroundGapMs.network': 'ms',
  'cache.backgroundGapMs.remote': 'ms',
  'cache.remoteIndexIntervalMin': 'min',
  'cache.interval.focus.local': 'sec',
  'cache.interval.near.local': 'sec',
  'cache.interval.far.local': 'sec',
  'cache.interval.focus.network': 'sec',
  'cache.interval.near.network': 'sec',
  'cache.interval.far.network': 'sec'
}

/** 枚举项的选项文案分组（settings:options.<分组>.<值>） */
const OPTION_GROUP: Partial<Record<SettingKey, string>> = {
  'general.language': 'language',
  'appearance.themeMode': 'themeMode',
  'appearance.accent': 'accent',
  'appearance.density': 'density',
  'appearance.reduceMotion': 'reduceMotion',
  'workspace.pickerStyle': 'pickerStyle',
  'cache.strategy.local': 'strategy',
  'cache.strategy.network': 'strategy'
}

/** 只对某个键显示的补充说明（settings:<note>） */
const NOTES: Partial<Record<SettingKey, string>> = { 'remote.keepaliveSec': 'keepaliveNote' }

export interface SettingRowProps {
  settingKey: SettingKey
  value: unknown
  /** 提交一个已通过校验的值（写入设置） */
  onCommit: (key: SettingKey, value: unknown) => void
}

/**
 * 一个设置项：名称与说明在左，控件在右；与默认值不同时右下显示「既定に戻す」。
 * 控件类型从 schema 推出（布尔 → 开关，枚举 → 下拉，数值 → 输入框 + 单位）
 */
export function SettingRow({ settingKey, value, onCommit }: SettingRowProps): JSX.Element {
  const { t } = useTranslation('settings')
  const id = itemId(settingKey)
  const kind = describeField(settingKey)
  const labelId = `setting-${id}-label`
  const changed = value !== DEFAULT_SETTINGS[settingKey]
  const note = NOTES[settingKey]

  let control: JSX.Element
  if (settingKey === 'appearance.theme') {
    control = (
      <ThemeChooser
        value={value as ThemeName}
        labelId={labelId}
        onChange={(v) => onCommit(settingKey, v)}
      />
    )
  } else if (kind.type === 'boolean') {
    control = (
      <Switch
        aria-labelledby={labelId}
        checked={value === true}
        onCheckedChange={(checked) => onCommit(settingKey, checked)}
      />
    )
  } else if (kind.type === 'enum') {
    const group = OPTION_GROUP[settingKey] ?? ''
    const options = kind.options.map((v) => ({ value: v, label: t(`options.${group}.${v}`) }))
    control = (
      <Select
        items={options}
        value={String(value)}
        onValueChange={(v) => {
          if (v !== null) onCommit(settingKey, v)
        }}
      >
        <SelectTrigger aria-labelledby={labelId} className="w-44">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    )
  } else if (kind.type === 'number') {
    const unit = UNITS[settingKey]
    control = (
      // value 变化（提交成功、恢复默认）时重建，草稿回到最新的值
      <NumberControl
        key={String(value)}
        settingKey={settingKey}
        value={Number(value)}
        labelId={labelId}
        unit={unit === undefined ? null : t(`unit.${unit}`)}
        min={kind.min}
        max={kind.max}
        onCommit={(v) => onCommit(settingKey, v)}
      />
    )
  } else {
    control = <span />
  }

  return (
    <div
      data-setting={settingKey}
      className="flex items-start justify-between gap-6 border-b py-4 last:border-b-0"
    >
      <div className="min-w-0 flex-1">
        <div id={labelId} className="text-sm font-medium">
          {t(`item.${id}.name`)}
        </div>
        <p className="mt-0.5 text-[13px] text-muted-foreground">{t(`item.${id}.desc`)}</p>
        {note ? <p className="mt-0.5 text-[13px] text-muted-foreground">{t(note)}</p> : null}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        {control}
        {changed ? (
          <Button
            variant="ghost"
            size="xs"
            onClick={() => onCommit(settingKey, DEFAULT_SETTINGS[settingKey])}
          >
            {t('reset')}
          </Button>
        ) : null}
      </div>
    </div>
  )
}

interface NumberControlProps {
  settingKey: SettingKey
  value: number
  labelId: string
  unit: string | null
  min: number | undefined
  max: number | undefined
  onCommit: (value: number) => void
}

/** 数值输入：失焦或 Enter 时校验，通过才提交；不通过显示错误并保留草稿，Esc 放弃 */
function NumberControl({
  settingKey,
  value,
  labelId,
  unit,
  min,
  max,
  onCommit
}: NumberControlProps): JSX.Element {
  const { t } = useTranslation('settings')
  const [draft, setDraft] = useState(String(value))
  const [error, setError] = useState<string | null>(null)

  const commit = (): void => {
    const result = validateSetting(settingKey, draft)
    if (!result.ok) {
      setError(
        result.message === 'range' && max === undefined
          ? t('error.min', { min })
          : t(`error.${result.message}`, { min, max })
      )
      return
    }
    setError(null)
    if (result.value !== value) onCommit(result.value as number)
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        <Input
          type="number"
          inputMode="numeric"
          aria-labelledby={labelId}
          aria-invalid={error !== null}
          min={min}
          max={max}
          value={draft}
          className="w-28 text-right"
          onChange={(e) => {
            setDraft(e.target.value)
            setError(null)
          }}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit()
            else if (e.key === 'Escape') {
              setDraft(String(value))
              setError(null)
            }
          }}
        />
        <span className="w-10 text-[13px] text-muted-foreground">{unit}</span>
      </div>
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  )
}

/** 默认主题在嵌套元素里无法还原（它的变量定义在 :root / .dark 上），预览用固定色 */
const DEFAULT_SWATCH = {
  light: { background: 'oklch(1 0 0)', primary: 'oklch(0.205 0 0)', muted: 'oklch(0.97 0 0)' },
  dark: { background: 'oklch(0.145 0 0)', primary: 'oklch(0.922 0 0)', muted: 'oklch(0.269 0 0)' }
}

function ThemePreview({ name, dark }: { name: ThemeName; dark: boolean }): JSX.Element {
  const fixed = name === 'default' ? DEFAULT_SWATCH[dark ? 'dark' : 'light'] : null
  return (
    <div
      data-theme={name === 'default' ? undefined : name}
      className={cn('flex h-12 w-full flex-col gap-1 rounded-sm border p-1.5', dark && 'dark')}
      style={{ background: fixed ? fixed.background : 'var(--background)' }}
      aria-hidden
    >
      <div
        className="h-2 w-2/3 rounded-full"
        style={{ background: fixed ? fixed.primary : 'var(--primary)' }}
      />
      <div
        className="h-2 w-full rounded-full"
        style={{ background: fixed ? fixed.muted : 'var(--muted)' }}
      />
      <div
        className="h-2 w-1/2 rounded-full"
        style={{ background: fixed ? fixed.muted : 'var(--accent)' }}
      />
    </div>
  )
}

/** 四套主题的卡片选择（带色板预览，跟随当前明暗） */
function ThemeChooser({
  value,
  labelId,
  onChange
}: {
  value: ThemeName
  labelId: string
  onChange: (value: ThemeName) => void
}): JSX.Element {
  const { t } = useTranslation('settings')
  const dark = useResolvedTheme() === 'dark'
  return (
    <div role="group" aria-labelledby={labelId} className="grid grid-cols-4 gap-2">
      {THEMES.map((name) => (
        <button
          key={name}
          type="button"
          aria-pressed={value === name}
          onClick={() => onChange(name)}
          className={cn(
            'flex w-24 flex-col gap-1.5 rounded-lg border p-1.5 text-left text-xs outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
            value === name ? 'border-primary ring-1 ring-primary' : 'hover:bg-accent/50'
          )}
        >
          <ThemePreview name={name} dark={dark} />
          <span className="px-0.5">{t(`options.theme.${name}`)}</span>
        </button>
      ))}
    </div>
  )
}
