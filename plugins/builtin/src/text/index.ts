import { definePreviewPlugin, TEXT_PLUGIN_ID } from '@pch/plugin-sdk'
import { messages } from './i18n'
import type { TextViewState } from './view-state'

/** 按扩展名交给文本插件的文件（设计 3.8：代码类同样按文本显示，无高亮） */
const TEXT_EXTENSIONS = [
  // 文本、日志、数据、配置
  'txt',
  'log',
  'out',
  'md',
  'csv',
  'tsv',
  'json',
  'jsonc',
  'xml',
  'yaml',
  'yml',
  'ini',
  'conf',
  'cfg',
  'properties',
  'toml',
  'sql',
  'env',
  'gitignore',
  'editorconfig',
  // 脚本
  'sh',
  'bat',
  'cmd',
  'ps1',
  'psm1',
  // 代码
  'js',
  'ts',
  'tsx',
  'jsx',
  'mjs',
  'cjs',
  'py',
  'java',
  'kt',
  'c',
  'h',
  'cc',
  'cpp',
  'hpp',
  'cs',
  'go',
  'rs',
  'rb',
  'php',
  'html',
  'htm',
  'css',
  'scss',
  'less',
  'vue',
  'svelte',
  'gradle'
]

/**
 * 文本 / 日志查看器（设计 devDoc/2026-11-20-18 3.5、3.8 节；doc 9.4）：自绘分页视图（行号栏、可缩放的滚动条）、
 * 编码下拉、行数 / 索引进度、部分模式「读取全部」、开头 / 末尾 / 跟随末尾。
 * 扩展名表之外的文件由容器 sniff，判为文本时也交给本插件（textLike）；兜底插件的「作为文本查看」指向本插件
 */
export const textPlugin = definePreviewPlugin<TextViewState>({
  manifest: {
    id: TEXT_PLUGIN_ID,
    name: 'name',
    version: '1.0.0',
    // 只处理本机文件（远程资源没有读取；M4 设计 5.8）
    match: { kinds: ['file'], schemes: ['file'], extensions: TEXT_EXTENSIONS, textLike: true },
    // 文件被删除时保留已显示的内容并提示「文件已不存在」（use-document.ts 的 missing）
    handlesMissing: true
  },
  i18n: messages,
  load: () => import('./text-view')
})
