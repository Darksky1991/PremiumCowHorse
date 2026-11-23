import type { JSX } from 'react'
import { builtinPlugins } from '@pch/plugin-builtin'
import { AddressBar } from '@renderer/features/address-bar'
import { CommandPalette, RecentRecorder } from '@renderer/features/command-palette'
import { ConnectionsView, HostKeyPrompts } from '@renderer/features/connections'
import { DesktopPrompts, DesktopView, SnapshotPage } from '@renderer/features/desktop'
import { AboutPage } from '@renderer/features/about'
import { ExplorerView, useExplorerCommands } from '@renderer/features/explorer'
import { PreviewContainer, previewPlugins } from '@renderer/features/preview'
import { SearchView } from '@renderer/features/search'
import { SettingsPage, SettingsWriteNotice, useSettingsCommands } from '@renderer/features/settings'
import { Shell } from '@renderer/features/shell'
import { TabsArea } from '@renderer/features/tabs'
import {
  WorkspaceAddressButton,
  WorkspacePicker,
  WorkspaceSwitcher,
  WorkspacesPage,
  useWorkspaceCommands
} from '@renderer/features/workspace'

/** 预览插件注册表的内容：内置插件（plugins/builtin），e2e 时追加测试插件 */
const plugins = previewPlugins(builtinPlugins)

/**
 * 根组件。M3 起按窗口角色（bootstrap 中的主窗口 / 弹出窗口）渲染不同外壳；
 * 两种窗口共用同一个页面，不需要路由库。
 * feature 之间不互相 import，侧栏视图、工作区切换器（标题栏按钮与地址框按钮，二者打开同一个选择器）、地址栏、标签区与标签内容（预览，
 * 其中工作区一览的视图来自 features/workspace，桌面记录页来自 features/desktop）在这里组合进外壳。
 */
export function App(): JSX.Element {
  useSettingsCommands()
  useExplorerCommands()
  useWorkspaceCommands()
  return (
    <>
      <Shell
        sidebarViews={{
          explorer: <ExplorerView />,
          search: <SearchView />,
          desktop: <DesktopView />,
          connections: <ConnectionsView />
        }}
        workspaceSwitcher={<WorkspaceSwitcher />}
        addressBar={<AddressBar workspacePicker={<WorkspaceAddressButton />} />}
        tabsArea={
          <TabsArea
            renderContent={(tab) => (
              <PreviewContainer
                tab={tab}
                plugins={plugins}
                renderWorkspaces={(page) => <WorkspacesPage tab={page} />}
                renderDesktop={(page) => <SnapshotPage tab={page} />}
                renderSettings={(page) => <SettingsPage tab={page} />}
                renderAbout={(page) => <AboutPage tab={page} />}
              />
            )}
          />
        }
      />
      <RecentRecorder />
      <SettingsWriteNotice />
      <CommandPalette />
      <WorkspacePicker />
      <DesktopPrompts />
      <HostKeyPrompts />
    </>
  )
}
