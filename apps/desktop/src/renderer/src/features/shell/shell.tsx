import type { JSX, ReactNode } from 'react'
import { useEffect } from 'react'
import { usePanelRef } from 'react-resizable-panels'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@pch/ui/components/resizable'
import { useActiveWorkspace } from '@renderer/data/workspace'
import { selectTabs, useTabsStore } from '@renderer/stores/tabs-store'
import { useUiStore, type SidebarView } from '@renderer/stores/ui-store'
import { ActivityBar } from './components/activity-bar'
import { SideBar } from './components/side-bar'
import { StatusBar } from './components/status-bar'
import { TitleBar } from './components/title-bar'
import { Welcome } from './components/welcome'
import { useReachabilityEvents } from './use-reachability-events'
import { useCommandShortcuts } from './use-command-shortcuts'
import { useAppearanceCommands } from './use-appearance-commands'
import { useShellCommands } from './use-shell-commands'

export interface ShellProps {
  /** 各侧栏视图的内容，由 app/ 组合（feature 之间不互相 import） */
  sidebarViews: Record<SidebarView, ReactNode>
  /** 标题栏中的工作区切换器 */
  workspaceSwitcher: ReactNode
  /** 标题栏正下方、横跨侧栏与内容区的一行：应用的地址栏（features/address-bar） */
  addressBar: ReactNode
  /** 主区域的标签区（标签栏 + 内容）；当前工作区没有标签时显示欢迎页 */
  tabsArea: ReactNode
}

/**
 * 主窗口整体布局（架构文档 12.2 节）：
 * 标题栏 / 地址栏 / 活动栏 + 可调宽侧栏 + 内容区 / 状态栏。
 * 内容区：当前工作区有标签时显示标签区（features/tabs），没有标签时显示欢迎页。
 */
export function Shell({
  sidebarViews,
  workspaceSwitcher,
  addressBar,
  tabsArea
}: ShellProps): JSX.Element {
  useCommandShortcuts()
  useShellCommands()
  useAppearanceCommands()
  useReachabilityEvents()
  const sidebarRef = usePanelRef()
  const collapsed = useUiStore((s) => s.sidebarCollapsed)
  const setCollapsed = useUiStore((s) => s.setSidebarCollapsed)
  const view = useUiStore((s) => s.sidebarView)
  const { data: workspace } = useActiveWorkspace()
  const hasTabs = useTabsStore((s) => selectTabs(workspace?.id)(s).tabs.length > 0)

  // store → 面板：活动栏点击、Ctrl+B
  useEffect(() => {
    const panel = sidebarRef.current
    if (!panel || panel.isCollapsed() === collapsed) return
    if (collapsed) panel.collapse()
    else panel.expand()
  }, [collapsed, sidebarRef])

  return (
    <div className="flex h-full flex-col">
      <TitleBar workspaceSwitcher={workspaceSwitcher} />
      {addressBar}
      <div className="flex min-h-0 flex-1">
        <ActivityBar />
        <ResizablePanelGroup orientation="horizontal" className="min-w-0 flex-1">
          <ResizablePanel
            id="sidebar"
            panelRef={sidebarRef}
            defaultSize={272}
            minSize={200}
            maxSize="45"
            collapsible
            collapsedSize={0}
            // 面板 → store：拖拽到最小宽度以下时自动折叠
            onResize={() => setCollapsed(sidebarRef.current?.isCollapsed() ?? false)}
          >
            <SideBar>{sidebarViews[view]}</SideBar>
          </ResizablePanel>
          <ResizableHandle />
          <ResizablePanel id="content" minSize="30">
            <main className="h-full min-w-0">{hasTabs ? tabsArea : <Welcome />}</main>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
      <StatusBar />
    </div>
  )
}
