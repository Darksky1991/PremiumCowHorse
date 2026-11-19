/**
 * 标签布局状态（M1-3 单窗口子集，doc 11.1 节）。
 * M1-3 由渲染端 store 持有；M3 多窗口时移到主进程 LayoutService，并扩展为 LayoutState / LayoutAction。
 */

/** 标签显示的位置的种类：工作区总览（内部 URI，不是文件系统）、目录、文件 */
export type LocationKind = 'workspace' | 'directory' | 'file'

/**
 * 标签显示的「位置」（M1-3b，设计 devDoc/2026-11-19-15 第 2.1 节）。
 * workspace：uri 为 `pch-workspace:<工作区 id>`（见 location.ts），不发给扫描进程；
 * directory / file：真实资源 URI。title 为标签标题（条目根时为条目标签，即别名）
 */
export interface TabLocation {
  uri: string
  kind: LocationKind
  title: string
}

/** 标签内的导航历史（浏览器式，每个标签独立、只在内存中）：各至多 TAB_HISTORY_LIMIT 项 */
export interface TabHistory {
  /** 后退栈：末尾为最近离开的位置 */
  back: TabLocation[]
  /** 前进栈：末尾为下一次「前进」到达的位置 */
  forward: TabLocation[]
}

export interface TabState extends TabLocation {
  id: string
  /** 预览标签：单击打开，再次预览打开其他资源时被替换（标题斜体） */
  preview: boolean
  /** 由插件定义：滚动位置、排序…（M1-3 不持久化） */
  viewState?: unknown
  history: TabHistory
}

export interface TabsState {
  tabs: TabState[]
  activeId: string | null
}

export type TabsAction =
  | ({ type: 'tab/open'; preview: boolean } & TabLocation)
  | { type: 'tab/close'; id: string }
  | { type: 'tab/activate'; id: string }
  | { type: 'tab/promote'; id: string }
  | ({ type: 'tab/navigate'; id: string } & TabLocation)
  | { type: 'tab/back'; id: string }
  | { type: 'tab/forward'; id: string }
  | { type: 'tab/viewState'; id: string; viewState: unknown }
