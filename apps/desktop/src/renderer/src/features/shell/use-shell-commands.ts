import { useTranslation } from 'react-i18next'
import { useRegisterCommands } from '@renderer/stores/command-store'
import { useUiStore } from '@renderer/stores/ui-store'
import { notifyComingSoon } from './coming-soon'

/**
 * 外壳级命令：命令面板、侧栏视图与新建工作区；工作区选择器（Task 12）实现前仍是「即将推出」的占位。
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
        // 面板打开时再按 Ctrl+K / Ctrl+Shift+P 关闭面板（模态中也要触发）
        id: 'palette.open',
        titleKey: 'commands:paletteOpen',
        group: 'general',
        shortcut: 'Ctrl+K',
        allowInEditable: true,
        allowWithModal: true,
        run: () => useUiStore.getState().togglePalette()
      },
      {
        id: 'palette.openAlt',
        titleKey: 'commands:paletteOpen',
        group: 'general',
        shortcut: 'Ctrl+Shift+P',
        allowInEditable: true,
        allowWithModal: true,
        hidden: true,
        run: () => useUiStore.getState().togglePalette()
      },
      {
        id: 'view.explorer',
        titleKey: 'commands:viewExplorer',
        group: 'view',
        run: () => useUiStore.getState().showView('explorer')
      },
      {
        id: 'view.desktop',
        titleKey: 'commands:viewDesktop',
        group: 'view',
        run: () => useUiStore.getState().showView('desktop')
      },
      {
        id: 'view.connections',
        titleKey: 'commands:viewConnections',
        group: 'view',
        run: () => useUiStore.getState().showView('connections')
      },
      {
        id: 'workspace.new',
        titleKey: 'commands:workspaceNew',
        group: 'workspace',
        run: () => useUiStore.getState().setNewWorkspaceOpen(true)
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
