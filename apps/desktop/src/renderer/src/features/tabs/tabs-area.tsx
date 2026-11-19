import { useEffect, useId, type JSX, type ReactNode } from 'react'
import type { TabState } from '@pch/shared'
import { useActiveWorkspace } from '@renderer/data/workspace'
import { selectTabs, useTabsStore } from '@renderer/stores/tabs-store'
import { panelDomId, tabDomId } from './dom-ids'
import { TabBar } from './tab-bar'

export interface TabsAreaProps {
  /** 激活标签的内容（features/preview 的 PreviewContainer，由 app/ 组合：feature 之间不互相 import） */
  renderContent: (tab: TabState) => ReactNode
}

/**
 * 主区域的标签区：标签栏 + 激活标签的内容。外壳只在当前工作区有标签时挂载它（否则显示欢迎页）。
 * 只渲染激活标签的内容；切换标签时按标签 id 重建。
 */
export function TabsArea({ renderContent }: TabsAreaProps): JSX.Element {
  const baseId = useId()
  const { data: workspace } = useActiveWorkspace()
  const state = useTabsStore(selectTabs(workspace?.id))
  const close = useTabsStore((s) => s.close)
  const active = state.tabs.find((tab) => tab.id === state.activeId) ?? null

  // Ctrl+W：关闭激活标签（应用菜单为空，Ctrl+W 不会关闭窗口）
  useEffect(() => {
    if (active === null) return
    const onKeyDown = (e: KeyboardEvent): void => {
      if (!e.ctrlKey || e.altKey || e.metaKey || e.shiftKey || e.key.toLowerCase() !== 'w') return
      e.preventDefault()
      close(active.id)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [active, close])

  return (
    <div className="flex h-full min-w-0 flex-col bg-background">
      <TabBar state={state} baseId={baseId} />
      {active ? (
        <div
          id={panelDomId(baseId)}
          role="tabpanel"
          aria-labelledby={tabDomId(baseId, active.id)}
          key={active.id}
          className="min-h-0 flex-1 overflow-hidden"
        >
          {renderContent(active)}
        </div>
      ) : null}
    </div>
  )
}
