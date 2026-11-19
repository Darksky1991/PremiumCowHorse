/**
 * 标签布局状态（M1-3 单窗口子集，doc 11.1 节）。
 * M1-3 由渲染端 store 持有；M3 多窗口时移到主进程 LayoutService，并扩展为 LayoutState / LayoutAction。
 */
export interface TabState {
  id: string
  /** 资源 URI */
  uri: string
  kind: 'file' | 'directory'
  title: string
  /** 预览标签：单击打开，再次预览打开其他资源时被替换（标题斜体） */
  preview: boolean
  /** 由插件定义：滚动位置、排序…（M1-3 不持久化） */
  viewState?: unknown
}

export interface TabsState {
  tabs: TabState[]
  activeId: string | null
}

export type TabsAction =
  | { type: 'tab/open'; uri: string; kind: 'file' | 'directory'; title: string; preview: boolean }
  | { type: 'tab/close'; id: string }
  | { type: 'tab/activate'; id: string }
  | { type: 'tab/promote'; id: string }
  | { type: 'tab/navigate'; id: string; uri: string; kind: 'file' | 'directory'; title: string }
  | { type: 'tab/viewState'; id: string; viewState: unknown }
