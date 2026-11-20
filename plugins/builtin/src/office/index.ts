import { definePreviewPlugin } from '@pch/plugin-sdk'
import { messages } from './i18n'

/**
 * Office 启动面板（doc 9.4 / 10.6）：不渲染内容，按主进程检测到的方式启动本机 Office。
 * 扩展名固定在 manifest（设置 launcher.officeExtensions 已删除）。
 */
export const officePlugin = definePreviewPlugin({
  manifest: {
    id: 'pch.preview.office',
    name: 'name',
    version: '1.0.0',
    match: {
      kinds: ['file'],
      extensions: [
        'xlsx',
        'xlsm',
        'xls',
        'xltx',
        'xltm',
        'xlsb',
        'docx',
        'docm',
        'doc',
        'dotx',
        'pptx',
        'pptm',
        'ppt',
        'potx'
      ]
    }
  },
  i18n: messages,
  load: () => import('./office-panel')
})
