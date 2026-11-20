import { definePreviewPlugin } from '@pch/plugin-sdk'
import { messages } from './i18n'

/** 参与匹配的大小上限：与主进程 `?pch-raw=1` 的上限（markdown-shell.ts 的 MARKDOWN_MAX_BYTES）相同，超过时落到文本 */
const MAX_SIZE = 5 * 1024 * 1024

/**
 * Markdown（设计 devDoc/2026-11-20-22-m2-design.md 5.4）：在本标签的浏览器视图中由应用自带的查看脚本渲染
 * （GFM、脚注、标题锚点、原始 HTML、mermaid 图；Markdown 中的脚本不执行）。界面与浏览器显示插件相同
 * （占位元素 + 一行状态），没有「システムのブラウザーで開く」（.md 在浏览器中无意义）。
 * priority 1：与文本插件的 md 同为扩展名 3 分时胜出（文本仍在候选中，可经查看器下拉切换）
 */
export const markdownPlugin = definePreviewPlugin({
  manifest: {
    id: 'pch.preview.markdown',
    name: 'name',
    version: '1.0.0',
    priority: 1,
    match: {
      kinds: ['file'],
      extensions: ['md', 'markdown', 'mdown', 'mkd'],
      maxSize: MAX_SIZE
    }
  },
  i18n: messages,
  load: () => import('./markdown-preview')
})
