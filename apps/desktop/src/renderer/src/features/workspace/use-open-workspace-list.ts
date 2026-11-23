import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { workspacesLocation } from '@pch/shared'
import { useReadActiveWorkspaceId } from '@renderer/data/workspace'
import { selectActiveTab, useTabsStore } from '@renderer/stores/tabs-store'

/**
 * 「ワークスペース一覧を開く / 管理…」：有激活标签时在其中导航到工作区一览（进入历史），
 * 没有标签时新建标签；已在一览则不动作（与原地址栏菜单的行为相同）
 */
export function useOpenWorkspaceList(): () => void {
  const { t } = useTranslation()
  const readActiveId = useReadActiveWorkspaceId()
  return useCallback(() => {
    const workspaceId = readActiveId()
    if (workspaceId === undefined) return
    const target = workspacesLocation(t('workspace:listPage'))
    const tabs = useTabsStore.getState()
    if (selectActiveTab(workspaceId)(tabs)?.uri === target.uri) return
    tabs.openHere(workspaceId, target)
  }, [readActiveId, t])
}
