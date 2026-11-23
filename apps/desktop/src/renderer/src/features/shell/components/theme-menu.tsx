import type { JSX } from 'react'
import { MonitorIcon, MoonIcon, SunIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { THEMES, type Settings, type ThemeName } from '@pch/shared'
import { Button } from '@pch/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@pch/ui/components/dropdown-menu'
import { useSetting, useUpdateSettings } from '@renderer/data/settings'
import { useResolvedTheme } from '@renderer/providers/theme-context'

type ThemeMode = Settings['appearance.themeMode']

export function ThemeMenu(): JSX.Element {
  const { t } = useTranslation()
  const mode = useSetting('appearance.themeMode') ?? 'system'
  const resolved = useResolvedTheme()
  const themeName = useSetting('appearance.theme') ?? 'default'
  const update = useUpdateSettings()

  const options: { value: ThemeMode; label: string; icon: typeof SunIcon }[] = [
    { value: 'light', label: t('themeLight'), icon: SunIcon },
    { value: 'dark', label: t('themeDark'), icon: MoonIcon },
    { value: 'system', label: t('followSystem'), icon: MonitorIcon }
  ]
  const themeLabels: Record<ThemeName, string> = {
    default: t('themeDefault'),
    aitetsu: t('themeAitetsu'),
    washi: t('themeWashi'),
    matsuba: t('themeMatsuba')
  }
  const TriggerIcon = mode === 'system' ? MonitorIcon : resolved === 'dark' ? MoonIcon : SunIcon

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="ghost" size="icon-sm" className="app-no-drag" aria-label={t('theme')} />
        }
      >
        <TriggerIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuGroup>
          <DropdownMenuLabel>{t('theme')}</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={mode}
            onValueChange={(value) => update.mutate({ 'appearance.themeMode': value as ThemeMode })}
          >
            {options.map(({ value, label, icon: Icon }) => (
              <DropdownMenuRadioItem key={value} value={value}>
                <Icon />
                {label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel>{t('themeColors')}</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={themeName}
            onValueChange={(value) => update.mutate({ 'appearance.theme': value as ThemeName })}
          >
            {THEMES.map((name) => (
              <DropdownMenuRadioItem key={name} value={name}>
                {themeLabels[name]}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
