import type { JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { useActiveWorkspace, workspaceDisplayName } from '@renderer/data/workspace'

/** 只读显示当前工作区名称（工作区切换器上线前的占位，见 Task 9） */
export function WorkspaceNameLabel(): JSX.Element {
  const { t } = useTranslation()
  const { data: active } = useActiveWorkspace()

  return (
    <span
      className="app-no-drag px-2 text-[13px] text-muted-foreground"
      aria-label={t('workspace')}
    >
      {active ? workspaceDisplayName(active, t('defaultWorkspace')) : null}
    </span>
  )
}
