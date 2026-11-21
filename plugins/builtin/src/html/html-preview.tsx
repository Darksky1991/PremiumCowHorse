import type { JSX } from 'react'
import type { PreviewProps } from '@pch/plugin-sdk'
import { WebPagePreview } from '../web-page/web-page-preview'

/** 浏览器显示：文件本身在本标签的浏览器视图中显示，状态行有「システムのブラウザーで開く」 */
export default function HtmlPreview(props: PreviewProps): JSX.Element {
  return <WebPagePreview {...props} view="page" external />
}
