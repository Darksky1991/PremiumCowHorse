import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useUiStore } from '@renderer/stores/ui-store'
import { notifyComingSoon } from './coming-soon'

/** 外壳级快捷键。M5 由命令面板统一注册与展示。 */
export function useShellShortcuts(): void {
  const { i18n } = useTranslation()
  const toggleSidebar = useUiStore((s) => s.toggleSidebar)
  const showView = useUiStore((s) => s.showView)
  const requestSearchFocus = useUiStore((s) => s.requestSearchFocus)

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (!e.ctrlKey || e.altKey || e.metaKey) return
      const key = e.key.toLowerCase()
      if (e.shiftKey) {
        // Ctrl+Shift+F：打开搜索视图并聚焦搜索框（Ctrl+F 留给将来的预览窗口）
        if (key !== 'f') return
        showView('search')
        requestSearchFocus()
      } else if (key === 'b') toggleSidebar()
      else if (key === 'k' || key === ',') notifyComingSoon(i18n)
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [i18n, toggleSidebar, showView, requestSearchFocus])
}
