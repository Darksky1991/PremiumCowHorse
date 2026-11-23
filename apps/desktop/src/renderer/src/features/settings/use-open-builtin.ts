import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { aboutLocation, settingsLocation } from '@pch/shared'
import { useActiveWorkspace } from '@renderer/data/workspace'
import { useTabsStore } from '@renderer/stores/tabs-store'

/** 在当前工作区打开关于页（设置页左侧导航最后一项） */
export function useOpenAbout(): () => void {
  const { t } = useTranslation('about')
  const { data: workspace } = useActiveWorkspace()
  const workspaceId = workspace?.id
  const title = t('title')
  return useCallback(() => {
    if (workspaceId !== undefined) useTabsStore.getState().open(workspaceId, aboutLocation(title))
  }, [workspaceId, title])
}

/**
 * 在当前工作区打开设置页（已打开时由标签存储切到现有标签）。
 * 命令面板与 Ctrl+, 的注册在 Task 8（useRegisterCommands）里用它接线
 */
export function useOpenSettings(): () => void {
  const { t } = useTranslation('settings')
  const { data: workspace } = useActiveWorkspace()
  const workspaceId = workspace?.id
  const title = t('title')
  return useCallback(() => {
    if (workspaceId !== undefined)
      useTabsStore.getState().open(workspaceId, settingsLocation(title))
  }, [workspaceId, title])
}
