import { useRegisterCommands } from '@renderer/stores/command-store'
import { useUiStore } from '@renderer/stores/ui-store'

/**
 * 工作区选择器的命令：Alt+W 打开（圆环式 / 菜单式按设置；菜单式锚定在标题栏按钮下）。
 * 圆环式是模态对话框，打开后快捷键分发不再处理 Alt+W（allowWithModal 为 false，其他对话框上也不会弹出），
 * 由面板自己处理 Alt+W 关闭；菜单式不是模态，再按 Alt+W 经这里关闭。命令面板中执行时直接调用 run
 */
export function useWorkspaceCommands(): void {
  useRegisterCommands(
    [
      {
        id: 'workspace.pick',
        titleKey: 'commands:workspacePick',
        group: 'workspace',
        shortcut: 'Alt+W',
        allowInEditable: true,
        run: () => useUiStore.getState().togglePicker('title')
      }
    ],
    []
  )
}
