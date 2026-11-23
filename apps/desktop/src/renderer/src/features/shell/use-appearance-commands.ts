import { THEMES, type Language, type Settings, type ThemeName } from '@pch/shared'
import { useUpdateSettings } from '@renderer/data/settings'
import { useRegisterCommands, type Command } from '@renderer/stores/command-store'

type ThemeMode = Settings['appearance.themeMode']
type LanguageSetting = Settings['general.language']

const MODE_KEYS: Record<ThemeMode, string> = {
  light: 'commands:themeModeLight',
  dark: 'commands:themeModeDark',
  system: 'commands:themeModeSystem'
}
const THEME_KEYS: Record<ThemeName, string> = {
  default: 'commands:themeColorDefault',
  aitetsu: 'commands:themeColorAitetsu',
  washi: 'commands:themeColorWashi',
  matsuba: 'commands:themeColorMatsuba'
}
const LANGUAGE_KEYS: Record<LanguageSetting, string> = {
  system: 'commands:langSystem',
  ja: 'commands:langJa',
  'zh-CN': 'commands:langZhCn',
  en: 'commands:langEn'
}

/** 外观命令（命令面板中出现）：明暗、配色主题、界面语言；与标题栏的菜单写同一组设置 */
export function useAppearanceCommands(): void {
  const update = useUpdateSettings()
  const mutate = update.mutate
  const commands: Command[] = [
    ...(Object.keys(MODE_KEYS) as ThemeMode[]).map((mode): Command => ({
      id: `appearance.mode.${mode}`,
      titleKey: MODE_KEYS[mode],
      group: 'appearance',
      run: () => mutate({ 'appearance.themeMode': mode })
    })),
    ...THEMES.map((name): Command => ({
      id: `appearance.theme.${name}`,
      titleKey: THEME_KEYS[name],
      group: 'appearance',
      run: () => mutate({ 'appearance.theme': name })
    })),
    ...(Object.keys(LANGUAGE_KEYS) as (Language | 'system')[]).map((lang): Command => ({
      id: `appearance.language.${lang}`,
      titleKey: LANGUAGE_KEYS[lang],
      group: 'appearance',
      run: () => mutate({ 'general.language': lang })
    }))
  ]
  useRegisterCommands(commands, [mutate])
}
