import type { JSX } from 'react'
import { useEffect } from 'react'
import { usePanelRef } from 'react-resizable-panels'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@pch/ui/components/resizable'
import { useUiStore } from '@renderer/stores/ui-store'
import { ActivityBar } from './components/activity-bar'
import { SideBar } from './components/side-bar'
import { StatusBar } from './components/status-bar'
import { TitleBar } from './components/title-bar'
import { Welcome } from './components/welcome'
import { useShellShortcuts } from './use-shell-shortcuts'

/**
 * 主窗口整体布局（架构文档 12.2 节）：
 * 标题栏 / 活动栏 + 可调宽侧栏 + 内容区 / 状态栏。
 * 标签栏与 PreviewContainer 在 M1–M2 接入内容区，没有标签时显示欢迎页。
 */
export function Shell(): JSX.Element {
  useShellShortcuts()
  const sidebarRef = usePanelRef()
  const collapsed = useUiStore((s) => s.sidebarCollapsed)
  const setCollapsed = useUiStore((s) => s.setSidebarCollapsed)

  // store → 面板：活动栏点击、Ctrl+B
  useEffect(() => {
    const panel = sidebarRef.current
    if (!panel || panel.isCollapsed() === collapsed) return
    if (collapsed) panel.collapse()
    else panel.expand()
  }, [collapsed, sidebarRef])

  return (
    <div className="flex h-full flex-col">
      <TitleBar />
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
            <SideBar />
          </ResizablePanel>
          <ResizableHandle />
          <ResizablePanel id="content" minSize="30">
            <main className="h-full min-w-0">
              <Welcome />
            </main>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
      <StatusBar />
    </div>
  )
}
