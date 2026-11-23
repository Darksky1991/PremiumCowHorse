import type { SettingKey } from '@pch/shared'

export type SectionId =
  | 'general'
  | 'appearance'
  | 'workspace'
  | 'explorer'
  | 'preview'
  | 'cache'
  | 'remote'
  | 'desktop'
  | 'privacy'

/**
 * 设置页的分区与顺序（设计 devDoc/2026-11-23-42 第 5.E 节）。
 * 不在此列的键：session.restoreOnStartup / window.onDetachedClose / launcher.autoUploadRemoteEdits /
 * remote.cacheSizeMB（没有代码读取）、workspace.pickerView（界面记忆，不是偏好），
 * 以及用单独列表控件的 preview.associations（在「资源管理器」分区末尾渲染）
 */
export const SETTINGS_SECTIONS: readonly { id: SectionId; keys: readonly SettingKey[] }[] = [
  { id: 'general', keys: ['general.language'] },
  {
    id: 'appearance',
    keys: [
      'appearance.theme',
      'appearance.themeMode',
      'appearance.accent',
      'appearance.density',
      'appearance.reduceMotion'
    ]
  },
  { id: 'workspace', keys: ['workspace.pickerStyle', 'workspace.pickerDetail'] },
  { id: 'explorer', keys: ['explorer.showHiddenFiles', 'explorer.singleClickPreview'] },
  { id: 'preview', keys: ['preview.maxTextSizeMB'] },
  {
    id: 'cache',
    keys: [
      'cache.strategy.local',
      'cache.strategy.network',
      'cache.activeDepth',
      'cache.interval.focus.local',
      'cache.interval.near.local',
      'cache.interval.far.local',
      'cache.interval.focus.network',
      'cache.interval.near.network',
      'cache.interval.far.network',
      'cache.backgroundGapMs.local',
      'cache.backgroundGapMs.network',
      'vfs.timeoutSec.local',
      'vfs.timeoutSec.network'
    ]
  },
  {
    id: 'remote',
    keys: [
      'remote.keepaliveSec',
      'remote.idleDisconnectMin',
      'vfs.timeoutSec.remote',
      'cache.backgroundGapMs.remote',
      'cache.remoteIndexIntervalMin'
    ]
  },
  { id: 'desktop', keys: ['desktop.askOnExit'] },
  { id: 'privacy', keys: [] }
]

/** 设置键 → i18n 资源中的条目 id（`.` 在 i18next 里是层级分隔符，换成 `_`） */
export function itemId(key: SettingKey): string {
  return key.replaceAll('.', '_')
}
