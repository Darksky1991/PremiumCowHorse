import { create } from 'zustand'

export type SidebarView = 'explorer' | 'connections'

interface UiState {
  sidebarView: SidebarView
  sidebarCollapsed: boolean
  /** 点击活动栏：切换视图；点击当前视图则折叠/展开侧栏 */
  activateView: (view: SidebarView) => void
  setSidebarCollapsed: (collapsed: boolean) => void
  toggleSidebar: () => void
}

/**
 * 纯 UI 状态。M3 起侧栏状态会作为会话快照的一部分持久化（SessionSnapshot.explorer）。
 */
export const useUiStore = create<UiState>((set, get) => ({
  sidebarView: 'explorer',
  sidebarCollapsed: false,
  activateView: (view) => {
    const { sidebarView, sidebarCollapsed } = get()
    if (view === sidebarView) set({ sidebarCollapsed: !sidebarCollapsed })
    else set({ sidebarView: view, sidebarCollapsed: false })
  },
  setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
  toggleSidebar: () => set({ sidebarCollapsed: !get().sidebarCollapsed })
}))
