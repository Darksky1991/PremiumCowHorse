import type { JSX } from 'react'
import type { PreviewProps } from '@pch/plugin-sdk'
import { WebPagePreview } from '../web-page/web-page-preview'

/**
 * Markdown：视图加载 `<文件>?pch-view=markdown` 的外壳页，由应用自带的查看脚本渲染；
 * 没有「システムのブラウザーで開く」（.md 在浏览器中无意义）
 */
export default function MarkdownPreview(props: PreviewProps): JSX.Element {
  return <WebPagePreview {...props} view="markdown" />
}
