/**
 * 浏览器视图（设计 devDoc/2026-11-20-22-m2-design.md 5.2 节）：插件经 PreviewHost.web 使用。
 * 插件不接触原生视图：只提供一个占位元素，宿主让本标签的浏览器视图（主进程的 WebContentsView）贴在它的位置上，
 * 并负责位置同步、链接导航、应用快捷键、刷新，以及应用的弹出层 / toast 出现时把视图换成截图。
 *
 * 这里的类型与 @pch/shared 的同名类型结构相同（SDK 不依赖 shared）；渲染端的宿主实现把 shared 的值直接赋给
 * 这里的类型，结构不一致时编译失败。
 */

/** 显示方式：page = 原样显示；markdown = 由应用自带的查看脚本渲染 */
export type WebViewKind = 'page' | 'markdown'

/** 视图内被阻止的动作：范围外的本地文件 / 下载 / 不支持的协议 */
export type WebNotice = 'outOfScope' | 'download' | 'unsupported'

/**
 * 页面状态（插件的状态行用）。failed：主框架加载失败时为错误码（可交给 host.i18n.describeError 得到文案），
 * 成功加载时为 null
 */
export interface WebPageState {
  title: string
  loading: boolean
  failed: string | null
}

export interface PreviewWebApi {
  /**
   * 让本标签的浏览器视图显示 uri（view：'page' 原样、'markdown' 渲染后），并贴在 element 的位置上
   * （element 的大小 / 位置变化时宿主同步）。同一标签已有视图且 uri 相同时复用（切换标签回来不重新加载）。
   * 返回解除函数（插件卸载或不再显示时调用）：只隐藏视图，不销毁；标签关闭或当前位置不再用网页查看器时宿主销毁它。
   * 一个标签同时只有一个占位元素：再次 attach 时先解除之前的
   */
  attach(element: HTMLElement, uri: string, opts: { view: WebViewKind }): () => void
  /** 页面状态；已有状态时订阅后立即回调一次。返回取消订阅函数 */
  onState(cb: (state: WebPageState) => void): () => void
  /** 视图内被阻止的动作（插件在状态行提示）。返回取消订阅函数 */
  onNotice(cb: (notice: WebNotice) => void): () => void
  /** 重新加载本标签的视图（加载失败后的「重试」；地址栏的刷新 / F5 由宿主处理，插件不必调用） */
  reload(): void
  /** 在系统中打开（出口：本地文件交给关联的应用，HTML 通常为默认浏览器）。失败时由宿主提示，Promise 不拒绝 */
  openExternal(uri: string): Promise<void>
}
