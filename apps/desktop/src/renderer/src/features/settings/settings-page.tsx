import type { JSX } from 'react'
import { useTranslation } from 'react-i18next'
import type { TabState } from '@pch/shared'

export interface SettingsPageProps {
  /** 显示设置页（kind 为 settings，uri 为 pch-settings:）的标签 */
  tab: TabState
}

/** 设置页的占位（只显示标题）：Task 7 替换为真正的设置页 */
// 标签本身目前不携带页面状态（单页、无参数），props 只为与其他内置页的 render 约定一致
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function SettingsPage(_props: SettingsPageProps): JSX.Element {
  const { t } = useTranslation('about')
  return (
    <div className="p-8">
      <h1 className="text-xl font-semibold">{t('settingsTitle')}</h1>
    </div>
  )
}
