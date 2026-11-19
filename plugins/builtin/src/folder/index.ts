import { definePreviewPlugin } from '@pch/plugin-sdk'
import { messages } from './i18n'
import type { FolderViewState } from './model'

/**
 * 目录视图（doc 9.4）：详细信息列表（名称、修改时间、类型、大小；列头排序、目录优先、虚拟滚动）、
 * 刷新；双击目录在同一标签内导航，双击文件以常驻标签打开，Backspace / Alt+↑ 经 host.tabs.up 到上一级。
 * 路径与「上一级」按钮由应用的地址栏提供（M1-3b）。所有访问都经 host。
 */
export const folderPlugin = definePreviewPlugin<FolderViewState>({
  manifest: {
    id: 'pch.preview.folder',
    name: 'name',
    version: '1.0.0',
    match: { kinds: ['directory'] }
  },
  i18n: messages,
  load: () => import('./folder-view')
})
