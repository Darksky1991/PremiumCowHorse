import { definePreviewPlugin, FALLBACK_PLUGIN_ID } from '@pch/plugin-sdk'
import { messages } from './i18n'

/**
 * 无任何插件匹配时使用（doc 9.3 / 9.4）：显示文件信息，并提供「在资源管理器中显示」
 * 「复制路径」「用系统应用打开」三个动作（对文件的操作只放在预览窗口中，需求方 2026-11-19）。
 */
export const fallbackPlugin = definePreviewPlugin({
  manifest: {
    id: FALLBACK_PLUGIN_ID,
    name: 'name',
    version: '1.0.0',
    match: {}
  },
  i18n: messages,
  load: () => import('./fallback-preview')
})
