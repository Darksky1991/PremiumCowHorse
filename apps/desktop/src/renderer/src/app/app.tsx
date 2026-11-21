import type { JSX } from 'react'
import { builtinPlugins } from '@pch/plugin-builtin'
import { AddressBar } from '@renderer/features/address-bar'
import { DesktopView, SnapshotPage } from '@renderer/features/desktop'
import { ExplorerView } from '@renderer/features/explorer'
import { PreviewContainer, previewPlugins } from '@renderer/features/preview'
import { SearchView } from '@renderer/features/search'
import { Shell, SidebarEmptyState } from '@renderer/features/shell'
import { TabsArea } from '@renderer/features/tabs'
import { WorkspaceSwitcher, WorkspacesPage } from '@renderer/features/workspace'

/** 预览插件注册表的内容：内置插件（plugins/builtin），e2e 时追加测试插件 */
const plugins = previewPlugins(builtinPlugins)

/**
 * 根组件。M3 起按窗口角色（bootstrap 中的主窗口 / 弹出窗口）渲染不同外壳；
 * 两种窗口共用同一个页面，不需要路由库。
 * feature 之间不互相 import，侧栏视图、工作区切换器、地址栏、标签区与标签内容（预览，
 * 其中工作区一览的视图来自 features/workspace，桌面记录页来自 features/desktop）在这里组合进外壳。
 */
export function App(): JSX.Element {
  return (
    <Shell
      sidebarViews={{
        explorer: <ExplorerView />,
        search: <SearchView />,
        desktop: <DesktopView />,
        connections: <SidebarEmptyState view="connections" />
      }}
      workspaceSwitcher={<WorkspaceSwitcher />}
      addressBar={<AddressBar />}
      tabsArea={
        <TabsArea
          renderContent={(tab) => (
            <PreviewContainer
              tab={tab}
              plugins={plugins}
              renderWorkspaces={(page) => <WorkspacesPage tab={page} />}
              renderDesktop={(page) => <SnapshotPage tab={page} />}
            />
          )}
        />
      }
    />
  )
}
