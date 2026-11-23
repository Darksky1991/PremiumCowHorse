import { create } from 'zustand'

export type SidebarView = 'explorer' | 'search' | 'desktop' | 'connections'

/** 打开工作区选择器的入口：标题栏按钮（含 Alt+W）或地址框的工作区按钮（菜单式锚定在该按钮下） */
export type PickerAnchor = 'title' | 'address'

interface UiState {
  sidebarView: SidebarView
  sidebarCollapsed: boolean
  /** 点击活动栏：切换视图；点击当前视图则折叠/展开侧栏 */
  activateView: (view: SidebarView) => void
  /** 显示某个视图（已是当前视图时不折叠）：快捷键、搜索结果的「在树中定位」 */
  showView: (view: SidebarView) => void
  setSidebarCollapsed: (collapsed: boolean) => void
  /** 「新建工作区」对话框的开关：标题栏切换器与欢迎页都能打开它（feature 之间不互相 import） */
  newWorkspaceOpen: boolean
  setNewWorkspaceOpen: (open: boolean) => void
  /**
   * 工作区一览中「削除…」的目标（name 为打开时的显示名）：确认框由常驻的标题栏切换器渲染，
   * 删除当前工作区时先切到默认工作区、一览页随之卸载，确认框仍保持到删除完成（M2-F2）
   */
  deleteWorkspaceTarget: { id: string; name: string } | null
  setDeleteWorkspaceTarget: (target: { id: string; name: string } | null) => void
  /** 命令面板的开关：Ctrl+K / 标题栏搜索按钮 */
  paletteOpen: boolean
  setPaletteOpen: (open: boolean) => void
  togglePalette: () => void
  /**
   * 工作区选择器的开关（标题栏、地址框、Alt+W 共用）：圆环式只看是否为 null，
   * 菜单式按 anchor 决定在哪个按钮下展开
   */
  pickerOpen: { anchor: PickerAnchor } | null
  setPickerOpen: (open: { anchor: PickerAnchor } | null) => void
  /** 已打开则关闭，否则从 anchor 打开 */
  togglePicker: (anchor: PickerAnchor) => void
  toggleSidebar: () => void
  /** 每次请求聚焦搜索框（Ctrl+Shift+F）时递增；搜索视图据此聚焦（挂载时也会聚焦） */
  searchFocusRequest: number
  requestSearchFocus: () => void
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
  showView: (view) => set({ sidebarView: view, sidebarCollapsed: false }),
  setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
  newWorkspaceOpen: false,
  setNewWorkspaceOpen: (open) => set({ newWorkspaceOpen: open }),
  deleteWorkspaceTarget: null,
  setDeleteWorkspaceTarget: (target) => set({ deleteWorkspaceTarget: target }),
  paletteOpen: false,
  setPaletteOpen: (open) => set({ paletteOpen: open }),
  togglePalette: () => set({ paletteOpen: !get().paletteOpen }),
  pickerOpen: null,
  setPickerOpen: (open) => set({ pickerOpen: open }),
  togglePicker: (anchor) => set({ pickerOpen: get().pickerOpen === null ? { anchor } : null }),
  toggleSidebar: () => set({ sidebarCollapsed: !get().sidebarCollapsed }),
  searchFocusRequest: 0,
  requestSearchFocus: () => set({ searchFocusRequest: get().searchFocusRequest + 1 })
}))
