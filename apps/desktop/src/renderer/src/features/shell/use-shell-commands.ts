import { useTranslation } from 'react-i18next'
import { useRegisterCommands } from '@renderer/stores/command-store'
import { useUiStore } from '@renderer/stores/ui-store'
import { notifyComingSoon } from './coming-soon'

/**
 * 外壳级命令：视图（搜索、侧栏）与尚未实现的占位（命令面板 Task 10、工作区选择器 Task 12，
 * 实现前仍提示「即将推出」）。
 */
export function useShellCommands(): void {
  const { i18n } = useTranslation()
  useRegisterCommands(
    [
      {
        // Ctrl+F 留给将来的预览窗口
        id: 'view.search',
        titleKey: 'commands:viewSearch',
        group: 'view',
        shortcut: 'Ctrl+Shift+F',
        allowInEditable: true,
        run: () => {
          const ui = useUiStore.getState()
          ui.showView('search')
          ui.requestSearchFocus()
        }
      },
      {
        id: 'view.toggleSidebar',
        titleKey: 'commands:viewToggleSidebar',
        group: 'view',
        shortcut: 'Ctrl+B',
        allowInEditable: true,
        run: () => useUiStore.getState().toggleSidebar()
      },
      {
        id: 'palette.open',
        titleKey: 'commands:paletteOpen',
        group: 'general',
        shortcut: 'Ctrl+K',
        allowInEditable: true,
        run: () => notifyComingSoon(i18n)
      },
      {
        id: 'palette.openAlt',
        titleKey: 'commands:paletteOpen',
        group: 'general',
        shortcut: 'Ctrl+Shift+P',
        allowInEditable: true,
        hidden: true,
        run: () => notifyComingSoon(i18n)
      },
      {
        id: 'workspace.pick',
        titleKey: 'commands:workspacePick',
        group: 'workspace',
        shortcut: 'Alt+W',
        allowInEditable: true,
        run: () => notifyComingSoon(i18n)
      }
    ],
    [i18n]
  )
}
