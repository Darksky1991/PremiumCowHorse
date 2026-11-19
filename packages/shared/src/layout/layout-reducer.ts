import type { TabState, TabsAction, TabsState } from './types'

/**
 * 标签布局的纯函数 reducer（单窗口子集，doc 11 节）。没有变化时返回同一个状态对象。
 * newId 生成新标签的 id（由调用方注入，便于测试）。
 *
 * - `tab/open`：同 URI 已打开 → 只激活（请求为常驻时顺带转常驻）；
 *   预览打开且已有预览标签 → 在原位置替换为新标签（新 id，viewState 不沿用）；
 *   否则插在激活标签右侧（没有激活标签时放在末尾）。
 * - `tab/close`：关闭激活标签时激活右侧相邻标签，没有则左侧，都没有则为 null。
 * - `tab/navigate`：同一标签内改 URI，转常驻并清除 viewState（M1-3 允许与其他标签的 URI 重复）。
 */
export function layoutReducer(
  state: TabsState,
  action: TabsAction,
  newId: () => string
): TabsState {
  switch (action.type) {
    case 'tab/open': {
      const existing = state.tabs.find((t) => t.uri === action.uri)
      if (existing) {
        const promote = !action.preview && existing.preview
        if (!promote && state.activeId === existing.id) return state
        return {
          tabs: promote ? replace(state.tabs, existing.id, { preview: false }) : state.tabs,
          activeId: existing.id
        }
      }
      const tab: TabState = {
        id: newId(),
        uri: action.uri,
        kind: action.kind,
        title: action.title,
        preview: action.preview
      }
      const previewIndex = action.preview ? state.tabs.findIndex((t) => t.preview) : -1
      if (previewIndex >= 0) {
        const tabs = [...state.tabs]
        tabs[previewIndex] = tab
        return { tabs, activeId: tab.id }
      }
      const activeIndex = state.tabs.findIndex((t) => t.id === state.activeId)
      const at = activeIndex < 0 ? state.tabs.length : activeIndex + 1
      return { tabs: [...state.tabs.slice(0, at), tab, ...state.tabs.slice(at)], activeId: tab.id }
    }
    case 'tab/close': {
      const index = state.tabs.findIndex((t) => t.id === action.id)
      if (index < 0) return state
      const tabs = state.tabs.filter((t) => t.id !== action.id)
      if (state.activeId !== action.id) return { tabs, activeId: state.activeId }
      // 右侧相邻标签移到了 index 位置；没有则取左侧
      const next = tabs[index] ?? tabs[index - 1] ?? null
      return { tabs, activeId: next?.id ?? null }
    }
    case 'tab/activate':
      if (state.activeId === action.id || !state.tabs.some((t) => t.id === action.id)) return state
      return { ...state, activeId: action.id }
    case 'tab/promote': {
      const tab = state.tabs.find((t) => t.id === action.id)
      if (!tab?.preview) return state
      return { ...state, tabs: replace(state.tabs, action.id, { preview: false }) }
    }
    case 'tab/navigate': {
      const tab = state.tabs.find((t) => t.id === action.id)
      if (!tab) return state
      const next: TabState = {
        id: tab.id,
        uri: action.uri,
        kind: action.kind,
        title: action.title,
        preview: false
      }
      return { ...state, tabs: state.tabs.map((t) => (t.id === action.id ? next : t)) }
    }
    case 'tab/viewState':
      if (!state.tabs.some((t) => t.id === action.id)) return state
      return { ...state, tabs: replace(state.tabs, action.id, { viewState: action.viewState }) }
  }
}

function replace(tabs: TabState[], id: string, patch: Partial<TabState>): TabState[] {
  return tabs.map((t) => (t.id === id ? { ...t, ...patch } : t))
}
