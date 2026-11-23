import { useEffect, type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { aboutLocation, settingsLocation } from '@pch/shared'
import { useActiveWorkspace } from '@renderer/data/workspace'
import { useTabsStore } from '@renderer/stores/tabs-store'

/** 事件名：`window.dispatchEvent(new CustomEvent('pch:open-builtin', { detail: 'about' }))` */
export const OPEN_BUILTIN_EVENT = 'pch:open-builtin'

/**
 * 以 window 事件在当前工作区打开设置页 / 关于页（不渲染任何内容）。
 * 活动栏齿轮、Ctrl+,、命令面板（Task 7 / 8）接线之前，e2e 用它打开内置页；
 * 之后仍可作为统一入口（事件只能打开这两个无参数的内置页）
 */
export function OpenBuiltinEvent(): JSX.Element | null {
  const { t } = useTranslation('about')
  const { data: workspace } = useActiveWorkspace()
  const workspaceId = workspace?.id
  useEffect(() => {
    if (workspaceId === undefined) return
    const onOpen = (e: Event): void => {
      const which = (e as CustomEvent<unknown>).detail
      if (which === 'about') {
        useTabsStore.getState().open(workspaceId, aboutLocation(t('title')))
      } else if (which === 'settings') {
        useTabsStore.getState().open(workspaceId, settingsLocation(t('settingsTitle')))
      }
    }
    window.addEventListener(OPEN_BUILTIN_EVENT, onOpen)
    return () => window.removeEventListener(OPEN_BUILTIN_EVENT, onOpen)
  }, [workspaceId, t])
  return null
}
