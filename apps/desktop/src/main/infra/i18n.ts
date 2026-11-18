import type { i18n } from 'i18next'
import type { Language } from '@pch/shared'
import { createI18n } from '@pch/i18n'

/** 主进程 i18next 实例：用于窗口标题、原生对话框、菜单等 */
export function createMainI18n(language: Language): i18n {
  return createI18n(language)
}
