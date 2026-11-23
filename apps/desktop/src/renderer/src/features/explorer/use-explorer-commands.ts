import { useEntries } from '@renderer/data/entries'
import { useActiveWorkspace } from '@renderer/data/workspace'
import { useRegisterCommands } from '@renderer/stores/command-store'
import { useNavigationStore } from '@renderer/stores/navigation-store'
import { selectActiveTab, useTabsStore } from '@renderer/stores/tabs-store'
import { useUiStore } from '@renderer/stores/ui-store'
import { useExplorerStore } from './explorer-store'
import { revealPath } from './reveal'

/**
 * 资源树的命令（命令面板中出现）：全部折叠、定位到当前项。
 * 与资源管理器标题行的按钮相同的动作，但不要求侧栏正显示资源管理器（定位时会切回它）
 */
export function useExplorerCommands(): void {
  const { data: workspace } = useActiveWorkspace()
  const workspaceId = workspace?.id
  const { data: entries } = useEntries(workspaceId)
  const activeUri = useTabsStore((s) => selectActiveTab(workspaceId)(s)?.uri ?? null)
  const locatable =
    workspaceId !== undefined &&
    entries !== undefined &&
    activeUri !== null &&
    revealPath(entries, activeUri) !== null

  useRegisterCommands(
    [
      {
        id: 'explorer.collapseAll',
        titleKey: 'commands:explorerCollapseAll',
        group: 'view',
        when: () => workspaceId !== undefined && entries !== undefined && entries.length > 0,
        run: () => {
          if (workspaceId === undefined) return
          useUiStore.getState().showView('explorer')
          useExplorerStore.getState().collapseAll(workspaceId)
        }
      },
      {
        id: 'explorer.locate',
        titleKey: 'commands:explorerLocate',
        group: 'view',
        when: () => locatable,
        run: () => {
          if (workspaceId === undefined || activeUri === null) return
          useUiStore.getState().showView('explorer')
          useNavigationStore.getState().requestReveal(workspaceId, activeUri, 'locate')
        }
      }
    ],
    [workspaceId, entries, activeUri, locatable]
  )
}
