import type { JSX } from 'react'
import { ExplorerView } from '@renderer/features/explorer'
import { Shell, SidebarEmptyState } from '@renderer/features/shell'
import { WorkspaceSwitcher } from '@renderer/features/workspace'

/**
 * 根组件。M3 起按窗口角色（bootstrap 中的主窗口 / 弹出窗口）渲染不同外壳；
 * 两种窗口共用同一个页面，不需要路由库。
 * feature 之间不互相 import，侧栏视图与工作区切换器在这里组合进外壳。
 */
export function App(): JSX.Element {
  return (
    <Shell
      sidebarViews={{
        explorer: <ExplorerView />,
        connections: <SidebarEmptyState view="connections" />
      }}
      workspaceSwitcher={<WorkspaceSwitcher />}
    />
  )
}
