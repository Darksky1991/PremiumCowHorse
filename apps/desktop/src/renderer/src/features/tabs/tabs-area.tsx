import { useEffect, useId, type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { useActiveWorkspace } from '@renderer/data/workspace'
import { selectTabs, useTabsStore } from '@renderer/stores/tabs-store'
import { panelDomId, tabDomId } from './dom-ids'
import { TabBar } from './tab-bar'

/**
 * 主区域的标签区：标签栏 + 激活标签的内容。外壳只在当前工作区有标签时挂载它（否则显示欢迎页）。
 * 内容区暂为占位（显示 URI），M1-3 Task 2 换成 PreviewContainer。
 */
export function TabsArea(): JSX.Element {
  const { t } = useTranslation('tabs')
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
          className="min-h-0 flex-1 overflow-auto p-6"
        >
          <p className="text-sm text-muted-foreground">{t('placeholder')}</p>
          <p className="mt-2 font-mono text-xs break-all select-text">{active.uri}</p>
        </div>
      ) : null}
    </div>
  )
}
