import { definePreviewPlugin } from '@pch/plugin-sdk'
import { messages } from './i18n'

/**
 * 浏览器显示（设计 devDoc/2026-11-20-22-m2-design.md 5.5）：本地 HTML 原型，以及浏览器能直接显示的
 * 图片与 PDF（先行验证 S3：Chromium 的图片文档与内置 PDF 查看器，不需要 plugins: true），
 * 在本标签的浏览器视图中显示（host.web）。占位元素 + 一行状态（标题、加载中、失败与「再試行」、被阻止的动作的提示、
 * 「システムのブラウザーで開く」）。priority 1：与文本插件的 html / htm 同为扩展名 3 分时胜出（文本仍在候选中）。
 * viewState 无：页面状态由视图保活，跨历史项不恢复。
 */
export const htmlPlugin = definePreviewPlugin({
  manifest: {
    id: 'pch.preview.html',
    name: 'name',
    version: '1.0.0',
    priority: 1,
    match: {
      kinds: ['file'],
      extensions: ['html', 'htm', 'xhtml', 'pdf', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp']
    }
  },
  i18n: messages,
  load: () => import('./html-preview')
})
