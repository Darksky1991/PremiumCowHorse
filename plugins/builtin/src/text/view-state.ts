import type { DocEncoding } from '@pch/plugin-sdk'

/**
 * 文本插件的 viewState（后退 / 前进恢复）：视口第一行、手动指定的编码（自动判断时不存在）、是否跟随末尾
 */
export interface TextViewState {
  top: number
  encoding?: DocEncoding
  follow: boolean
}
