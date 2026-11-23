import { useRegisterCommands } from '@renderer/stores/command-store'
import { useOpenAbout, useOpenSettings } from './use-open-builtin'

/** 设置页与关于页的命令（Ctrl+, 打开设置；关于页没有快捷键，只在命令面板中） */
export function useSettingsCommands(): void {
  const openSettings = useOpenSettings()
  const openAbout = useOpenAbout()
  useRegisterCommands(
    [
      {
        id: 'settings.open',
        titleKey: 'commands:settingsOpen',
        group: 'general',
        shortcut: 'Ctrl+,',
        allowInEditable: true,
        run: openSettings
      },
      { id: 'about.open', titleKey: 'commands:aboutOpen', group: 'general', run: openAbout }
    ],
    [openSettings, openAbout]
  )
}
