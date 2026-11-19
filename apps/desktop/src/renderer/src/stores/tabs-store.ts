import { create } from 'zustand'
import { layoutReducer, type TabState, type TabsAction, type TabsState } from '@pch/shared'

export type TabTarget = Pick<TabState, 'uri' | 'kind' | 'title'>

interface TabsStore {
  /** 工作区 id → 该工作区的标签集合（只在内存中，不持久化） */
  byWorkspace: Record<string, TabsState>
  /** 在工作区中打开资源（preview：单击的预览打开） */
  open: (workspaceId: string, target: TabTarget & { preview: boolean }) => void
  close: (id: string) => void
  activate: (id: string) => void
  /** 预览标签转常驻 */
  promote: (id: string) => void
  /** 在同一标签内导航到另一资源 */
  navigate: (id: string, target: TabTarget) => void
  setViewState: (id: string, viewState: unknown) => void
}

const EMPTY: TabsState = { tabs: [], activeId: null }

let seq = 0
const newId = (): string => `tab-${++seq}`

/**
 * 标签布局（doc 11 节）。M1-3 只有单窗口，由渲染端持有 layoutReducer 的状态；
 * M3 多窗口时移到主进程 LayoutService，本 store 改为镜像。
 * 跨 feature：资源树经此打开标签，标签栏（features/tabs）显示与关闭，外壳据此在欢迎页与标签区之间切换。
 * 标签 id 全局唯一，按 id 的操作自行找到所属工作区。
 */
export const useTabsStore = create<TabsStore>((set, get) => {
  /** 对一个工作区应用动作；没有变化时不更新 store */
  const dispatch = (workspaceId: string, action: TabsAction): void => {
    const { byWorkspace } = get()
    const prev = byWorkspace[workspaceId] ?? EMPTY
    const next = layoutReducer(prev, action, newId)
    if (next !== prev) set({ byWorkspace: { ...byWorkspace, [workspaceId]: next } })
  }
  const dispatchById = (action: TabsAction & { id: string }): void => {
    const entry = Object.entries(get().byWorkspace).find(([, s]) =>
      s.tabs.some((t) => t.id === action.id)
    )
    if (entry) dispatch(entry[0], action)
  }
  return {
    byWorkspace: {},
    open: (workspaceId, target) => dispatch(workspaceId, { type: 'tab/open', ...target }),
    close: (id) => dispatchById({ type: 'tab/close', id }),
    activate: (id) => dispatchById({ type: 'tab/activate', id }),
    promote: (id) => dispatchById({ type: 'tab/promote', id }),
    navigate: (id, target) => dispatchById({ type: 'tab/navigate', id, ...target }),
    setViewState: (id, viewState) => dispatchById({ type: 'tab/viewState', id, viewState })
  }
})

/** 工作区的标签集合的选择器；没有标签时返回同一个空状态（引用稳定） */
export const selectTabs =
  (workspaceId: string | undefined) =>
  (s: Pick<TabsStore, 'byWorkspace'>): TabsState =>
    (workspaceId === undefined ? undefined : s.byWorkspace[workspaceId]) ?? EMPTY

/**
 * 工作区的激活标签显示目录时为其 URI，否则为 null（文件、没有标签）。
 * 标签区据此告诉扫描进程「标签中显示的目录」（vfs.interest 的 tabs，按关注点处理）
 */
export const selectActiveDirectory =
  (workspaceId: string | undefined) =>
  (s: Pick<TabsStore, 'byWorkspace'>): string | null => {
    const { tabs, activeId } = selectTabs(workspaceId)(s)
    const active = tabs.find((t) => t.id === activeId)
    return active?.kind === 'directory' ? active.uri : null
  }
