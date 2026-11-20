/** 浏览器视图的显示方式：page = 原样显示；markdown = 由应用自带的查看脚本渲染（Task 8） */
export type WebViewKind = 'page' | 'markdown'

/** 视图在窗口内容区中的位置（DIP，整数；宿主页面缩放为 1 时与 CSS 像素相同，不乘 devicePixelRatio） */
export interface WebBounds {
  x: number
  y: number
  width: number
  height: number
}

/**
 * 视图的页面状态（只发给所属窗口）。failed：主框架加载失败时的错误码——
 * Chromium 的网络错误名（`did-fail-load` 的 errorDescription，如 `ERR_FILE_NOT_FOUND`），
 * 或协议处理器返回 4xx / 5xx 时的 `HTTP_<状态码>`（如 `HTTP_404`）；成功加载时为 null
 */
export interface WebViewState {
  tabId: string
  title: string
  loading: boolean
  failed: string | null
}

/** 视图内被阻止的动作：范围外的本地文件 / 下载 / 不支持的协议 */
export type WebNotice = 'outOfScope' | 'download' | 'unsupported'

/** 应用快捷键（key 为 KeyboardEvent.key；字母为小写） */
export interface WebShortcut {
  key: string
  ctrl: boolean
  shift: boolean
  alt: boolean
}
