import { create } from 'zustand'
import {
  layoutReducer,
  shouldRecordRecent,
  type OpenSource,
  type TabLocation,
  type TabState,
  type TabsAction,
  type TabsState
} from '@pch/shared'

/** 标签打开 / 导航的目标：位置（工作区总览、目录、文件） */
export type TabTarget = TabLocation

/** 「最近使用」的记录信号：seq 每次命中加 1；由 features/command-palette 的 RecentRecorder 订阅（store 不调 IPC） */
export interface RecentSignal {
  seq: number
  workspaceId: string | null
  location: TabLocation | null
}

interface TabsStore {
  /** 明确打开（opts.source 命中 shouldRecordRecent）时更新；后退 / 前进 / 未指定来源不更新 */
  recentSignal: RecentSignal
  /** 工作区 id → 该工作区的标签集合（只在内存中，不持久化） */
  byWorkspace: Record<string, TabsState>
  /** 在工作区中以新标签打开（同 URI 已打开则只激活） */
  open: (workspaceId: string, target: TabTarget, opts?: { source?: OpenSource }) => void
  /**
   * 浏览器式的打开（设计 2.8）：在当前（激活）标签内导航，进入其历史；工作区没有激活标签时新建一个。
   * newTab（中键 / Ctrl+单击 / 「在新标签页中打开」）时与 open 相同。
   * viewer：以该查看器（插件 id）打开，null / 省略 = 自动选择；当前标签已在该位置时，
   * 指定 viewer（含 null）只换查看器、不入栈（见 layoutReducer 的 tab/navigate）
   */
  openHere: (
    workspaceId: string,
    target: TabTarget,
    opts?: { newTab?: boolean; viewer?: string | null; source?: OpenSource }
  ) => void
  close: (id: string) => void
  activate: (id: string) => void
  /** 在同一标签内导航到另一位置（离开的位置进入该标签的后退栈） */
  navigate: (id: string, target: TabTarget, opts?: { source?: OpenSource }) => void
  /** 该标签的历史中后退 / 前进（没有可去的位置时不变） */
  back: (id: string) => void
  forward: (id: string) => void
  /**
   * 标签仍在 uri 这个位置时后退一步（没有后退历史或已离开该位置时不变）。
   * 从工作区一览切换到另一个工作区后，旧工作区中显示一览的标签据此回到之前的位置，
   * 以后切回旧工作区时不会停在一览页
   */
  backFrom: (id: string, uri: string) => void
  /** uri：viewState 所属的位置（标签已离开它时写入刚离开的历史项，见 layoutReducer） */
  setViewState: (id: string, viewState: unknown, uri?: string) => void
  /** 为标签当前位置选择查看器（插件 id；null = 恢复自动选择） */
  setViewer: (id: string, viewer: string | null) => void
  /**
   * 标签 id → 刷新请求的序号（地址栏的刷新按钮 / F5 递增；不在 layoutReducer 中，不是布局状态）。
   * 标签内容（PreviewContainer）订阅其变化后刷新：目录重新确认并列出、文件重新 stat、总览重新取得条目
   */
  refreshSeq: Record<string, number>
  requestRefresh: (id: string) => void
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
  /** 来源命中记录规则时发出记录信号 */
  const signal = (workspaceId: string, target: TabTarget, source: OpenSource | undefined): void => {
    if (!shouldRecordRecent(target.kind, source)) return
    set({
      recentSignal: { seq: get().recentSignal.seq + 1, workspaceId, location: target }
    })
  }
  const dispatchById = (action: TabsAction & { id: string }): void => {
    const entry = Object.entries(get().byWorkspace).find(([, s]) =>
      s.tabs.some((t) => t.id === action.id)
    )
    if (entry) dispatch(entry[0], action)
  }
  return {
    byWorkspace: {},
    recentSignal: { seq: 0, workspaceId: null, location: null },
    open: (workspaceId, target, opts) => {
      dispatch(workspaceId, { type: 'tab/open', ...target })
      signal(workspaceId, target, opts?.source)
    },
    openHere: (workspaceId, target, opts) => {
      const { activeId } = get().byWorkspace[workspaceId] ?? EMPTY
      const viewer = opts?.viewer
      if (opts?.newTab === true || activeId === null) {
        dispatch(workspaceId, {
          type: 'tab/open',
          ...target,
          ...(viewer == null ? {} : { viewer })
        })
      } else {
        dispatch(workspaceId, {
          type: 'tab/navigate',
          id: activeId,
          ...target,
          ...(viewer === undefined ? {} : { viewer })
        })
      }
      signal(workspaceId, target, opts?.source)
    },
    close: (id) => dispatchById({ type: 'tab/close', id }),
    activate: (id) => dispatchById({ type: 'tab/activate', id }),
    navigate: (id, target, opts) => {
      dispatchById({ type: 'tab/navigate', id, ...target })
      const workspaceId = Object.entries(get().byWorkspace).find(([, st]) =>
        st.tabs.some((t) => t.id === id)
      )?.[0]
      if (workspaceId !== undefined) signal(workspaceId, target, opts?.source)
    },
    back: (id) => dispatchById({ type: 'tab/back', id }),
    forward: (id) => dispatchById({ type: 'tab/forward', id }),
    backFrom: (id, uri) => {
      if (findTab(get(), id)?.uri === uri) dispatchById({ type: 'tab/back', id })
    },
    setViewState: (id, viewState, uri) =>
      dispatchById({
        type: 'tab/viewState',
        id,
        viewState,
        ...(uri !== undefined ? { uri } : {})
      }),
    setViewer: (id, viewer) => dispatchById({ type: 'tab/viewer', id, viewer }),
    refreshSeq: {},
    requestRefresh: (id) => {
      const { refreshSeq } = get()
      set({ refreshSeq: { ...refreshSeq, [id]: (refreshSeq[id] ?? 0) + 1 } })
    }
  }
})

/** 工作区的标签集合的选择器；没有标签时返回同一个空状态（引用稳定） */
export const selectTabs =
  (workspaceId: string | undefined) =>
  (s: Pick<TabsStore, 'byWorkspace'>): TabsState =>
    (workspaceId === undefined ? undefined : s.byWorkspace[workspaceId]) ?? EMPTY

/**
 * 在所有工作区中按 id 找标签；不存在（已关闭）时为 null。
 * 预览宿主据此在标签关闭 / 当前位置改变时销毁浏览器视图（web.release 由 features/preview 发出：
 * 分层规则不允许 store 调用 IPC）
 */
export function findTab(s: Pick<TabsStore, 'byWorkspace'>, id: string): TabState | null {
  for (const state of Object.values(s.byWorkspace)) {
    const tab = state.tabs.find((t) => t.id === id)
    if (tab) return tab
  }
  return null
}

/** 工作区的激活标签；没有工作区或没有标签时为 null（地址栏显示它的位置） */
export const selectActiveTab =
  (workspaceId: string | undefined) =>
  (s: Pick<TabsStore, 'byWorkspace'>): TabState | null => {
    const { tabs, activeId } = selectTabs(workspaceId)(s)
    return tabs.find((t) => t.id === activeId) ?? null
  }

/**
 * 工作区的激活标签显示目录时为其 URI，否则为 null（文件、工作区总览、没有标签）。
 * 标签区据此告诉扫描进程「标签中显示的目录」（vfs.interest 的 tabs，按关注点处理）
 */
export const selectActiveDirectory =
  (workspaceId: string | undefined) =>
  (s: Pick<TabsStore, 'byWorkspace'>): string | null => {
    const active = selectActiveTab(workspaceId)(s)
    return active?.kind === 'directory' ? active.uri : null
  }

/** 订阅标签的刷新请求（requestRefresh）；返回取消订阅函数。标签内容（预览宿主、总览）用它 */
export function onTabRefresh(id: string, listener: () => void): () => void {
  return useTabsStore.subscribe((s, prev) => {
    if (s.refreshSeq[id] !== prev.refreshSeq[id]) listener()
  })
}
