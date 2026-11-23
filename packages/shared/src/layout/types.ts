/**
 * 标签布局状态（M1-3 单窗口子集，doc 11.1 节）。
 * M1-3 由渲染端 store 持有；M3 多窗口时移到主进程 LayoutService，并扩展为 LayoutState / LayoutAction。
 */

/**
 * 打开位置的来源（M5 D1，决定是否记入「最近使用」，见渲染端 lib/recent-policy.ts）：
 * tree-select 资源树单击 / 键盘移动、tree-open 资源树激活 / 新标签、palette 命令面板、overview 工作区总览、
 * address 地址栏、plugin 预览插件、history 后退 / 前进
 */
export type OpenSource =
  'tree-select' | 'tree-open' | 'palette' | 'overview' | 'address' | 'plugin' | 'history'

/**
 * 标签显示的位置的种类：工作区总览 / 工作区一览 / 桌面记录 / 设置页 / 关于页（内部 URI，不是文件系统）、目录、文件
 */
export type LayoutLocationKind =
  'workspace' | 'workspaces' | 'desktop' | 'settings' | 'about' | 'directory' | 'file'

/**
 * 标签显示的「位置」（M1-3b，设计 devDoc/2026-11-19-15 第 2.1 节）。
 * workspace：uri 为 `pch-workspace:<工作区 id>`（见 location.ts），不发给扫描进程；
 * workspaces：工作区一览，uri 固定为 `pch-workspaces:`（总览的上一级，同样不发给扫描进程）；
 * desktop：桌面记录页，uri 为 `pch-desktop:<快照 id | current>`（同样不发给扫描进程）；
 * settings / about：设置页 `pch-settings:` / 关于页 `pch-about:`（单页、无参数，同样不是文件系统）；
 * directory / file：真实资源 URI。title 为标签标题（条目根时为条目标签，即别名）
 */
export interface TabLocation {
  uri: string
  kind: LayoutLocationKind
  title: string
}

/**
 * 历史中的一项：位置与离开它时的 viewState（后退 / 前进回到该位置时恢复，
 * 如目录视图的排序、滚动位置、选中项；没有时不含该键）
 */
export interface TabHistoryEntry extends TabLocation {
  viewState?: unknown
  /** 用户为该位置选的查看器（插件 id）；没有时按注册表自动选择 */
  viewer?: string
}

/** 标签内的导航历史（浏览器式，每个标签独立、只在内存中）：各至多 TAB_HISTORY_LIMIT 项 */
export interface TabHistory {
  /** 后退栈：末尾为最近离开的位置 */
  back: TabHistoryEntry[]
  /** 前进栈：末尾为下一次「前进」到达的位置 */
  forward: TabHistoryEntry[]
}

/**
 * 标签（M1-3b 设计 2.8 起没有「预览标签」：所有标签都是普通标签，
 * 单击在当前标签打开、中键 / Ctrl+单击在新标签打开）
 */
export interface TabState extends TabLocation {
  id: string
  /** 由插件定义：滚动位置、排序…（M1-3 不持久化） */
  viewState?: unknown
  /** 用户为当前位置选的查看器（插件 id）：随位置进入历史，导航到新位置时清除 */
  viewer?: string
  history: TabHistory
}

export interface TabsState {
  tabs: TabState[]
  activeId: string | null
}

export type TabsAction =
  /** viewer：新标签以该查看器显示（省略时自动选择）；同 URI 已打开时只激活，不改其查看器 */
  | ({ type: 'tab/open'; viewer?: string } & TabLocation)
  | { type: 'tab/close'; id: string }
  | { type: 'tab/activate'; id: string }
  /**
   * viewer：新位置以该查看器显示（null / 省略 = 自动选择）。导航到当前 URI 时，
   * 指定了 viewer（含 null）则同一位置换查看器（与 tab/viewer 相同，不入栈）；省略时保留当前查看器
   */
  | ({ type: 'tab/navigate'; id: string; viewer?: string | null } & TabLocation)
  | { type: 'tab/back'; id: string }
  | { type: 'tab/forward'; id: string }
  /**
   * uri：该 viewState 所属的位置。标签已离开它（导航 / 后退 / 前进之后视图才卸载并补存）时
   * 写入刚离开的历史项（后退栈顶或前进栈顶中 URI 相同者）；都不是时忽略。省略时写入当前位置
   */
  | { type: 'tab/viewState'; id: string; viewState: unknown; uri?: string }
  /** 为当前位置选择查看器（null = 恢复自动选择）；viewState 属于上一个查看器，同时清除 */
  | { type: 'tab/viewer'; id: string; viewer: string | null }
